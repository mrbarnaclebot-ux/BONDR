// The chain steps of prepare: table keys, the ops-paid per-coin table, the compiled launch message and its
// simulation. Only the worker runs these, because the mint and W keys derive from the seed here (FEE-10).

import { createTable, tableKeys } from "@bondr/core/alt";
import type { ApiError } from "@bondr/core/api";
import { exitPresent } from "@bondr/core/cosign";
import { AwaitingMigration, buildLaunch, type LaunchOpts } from "@bondr/core/launch";
import { redact } from "@bondr/core/net";
import { checkMessage, messageSize, PACKET_LIMIT } from "@bondr/core/send";
import {
  type AddressLookupTableAccount,
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  type VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { fail } from "./http.ts";

type Built = Awaited<ReturnType<typeof buildLaunch>>;
export type Builds = { burn: Built; sell: Built };

// Helius free allows about one send per second (Pitfall 8).
const TABLE_PACE_MS = 1100;
// Below this ops pays for no new table: what is left stays for fee and recovery txs. buildFailed logs it, so
// Sentry tells the owner to top ops up by hand (01-10).
const OPS_FLOOR_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
// pump: a child create on a complete, unmigrated BONDR (the 6107 window, 01-05).
const AWAITING_CODE = 6107;

const buildFailed = (why: string) => {
  console.error(`prepare build failed: ${redact(why)}`);
  return fail({ error: "build_failed" });
};

function build(o: LaunchOpts): Promise<Built> {
  return buildLaunch(o).catch((e: unknown) => {
    if (e instanceof AwaitingMigration) throw fail({ error: "paused", paused: "awaiting_migration" });
    throw e;
  });
}

// Both exits go into one table, so a retry with the other exit never needs a new one (Pattern 4). Keys depend
// on the mint, W, the dev and BONDR's venue, never on amounts or text.
export async function unionTableKeys(o: LaunchOpts): Promise<{ keys: PublicKey[]; builds: Builds }> {
  // Two builds of five RPC reads each in parallel: well under Helius free's 10 RPS, and about 1 s faster.
  const [burn, sell] = await Promise.all([build({ ...o, exit: "burn" }), build({ ...o, exit: "sell" })]);
  const builds = { burn, sell };
  const all = [...tableKeys(builds.burn.ixs), ...tableKeys(builds.sell.ixs)];
  const keys = [...new Map(all.map((k) => [k.toBase58(), k])).values()];
  return { keys, builds };
}

async function reusable(conn: Connection, address: string, keys: PublicKey[]) {
  const t = (await conn.getAddressLookupTable(new PublicKey(address))).value;
  if (!t?.isActive()) return null;
  const have = new Set(t.state.addresses.map((a) => a.toBase58()));
  return keys.every((k) => have.has(k.toBase58())) ? t : null;
}

// Ops pays the table rent (PROJECT.md item 9). A prior table missing a key (BONDR changed venue) is replaced.
// A new table that is not usable is still returned with its address: ops paid for it, so the caller records
// it before refusing (WR-02).
export async function ensureTable(conn: Connection, ops: Keypair, keys: PublicKey[], prior: string | null) {
  const old = prior ? await reusable(conn, prior, keys) : null;
  if (old) return { table: old, address: old.key.toBase58(), created: false };
  const balance = await conn.getBalance(ops.publicKey);
  if (balance < OPS_FLOOR_LAMPORTS) throw buildFailed(`ops below floor: ${balance / LAMPORTS_PER_SOL} SOL`);
  const r = await createTable(conn, ops, keys, TABLE_PACE_MS);
  const address = r.address.toBase58();
  if (!r.table)
    console.error(`prepare build failed: ${redact(`lookup table ${address}: ${r.err ?? "not warm"}`)}`);
  return { table: r.table, address, created: true };
}

// Payer is the dev (signature 0) and the mint is signature 1: submit relies on that order (Pattern 3). The
// exit check repeats submit's, so a builder change that drops the exit fails at prepare, not at sign time.
export function compileLaunch(
  o: Pick<LaunchOpts, "dev" | "mint" | "exit">,
  ixs: TransactionInstruction[],
  table: AddressLookupTableAccount,
  blockhash: string,
): VersionedMessage {
  const msg = new TransactionMessage({ payerKey: o.dev, recentBlockhash: blockhash, instructions: ixs });
  const v0 = msg.compileToV0Message([table]);
  const refused = checkMessage(v0);
  if (refused) throw buildFailed(refused);
  const bytes = messageSize(v0);
  if (bytes > PACKET_LIMIT) throw buildFailed(`${bytes} bytes`);
  if (v0.header.numRequiredSignatures !== 2 || !v0.staticAccountKeys[1]?.equals(o.mint))
    throw buildFailed("signer layout");
  if (o.exit === "sellq" || !exitPresent(v0, [table], { exit: o.exit, mint: o.mint, dev: o.dev }))
    throw buildFailed(`exit ${o.exit} missing`);
  return v0;
}

export async function buildMessage(o: LaunchOpts, table: AddressLookupTableAccount, blockhash: string) {
  const built = await build(o);
  return { ...built, msg: compileLaunch(o, built.ixs, table, blockhash) };
}

function customCode(err: unknown): number | undefined {
  const ie = (err as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError;
  return typeof ie?.[1]?.Custom === "number" ? ie[1].Custom : undefined;
}

// Pure, so the mapping is unit tested. Token program custom 1 is its InsufficientFunds.
export function simError(err: unknown, logs: readonly string[] | null): ApiError {
  const code = customCode(err);
  if (code === AWAITING_CODE) return { error: "paused", paused: "awaiting_migration" };
  const text = `${JSON.stringify(err)} ${(logs ?? []).join(" ")}`;
  if (/insufficient (lamports|funds)|InsufficientFunds|AccountNotFound/i.test(text) || code === 1)
    return { error: "insufficient_balance" };
  return { error: "build_failed" };
}

// Lamports the dev's balance drops by, read from the simulation's post state of the dev (agencybook build.ts).
export async function simulateLaunch(
  conn: Connection,
  msg: VersionedMessage,
  dev: PublicKey,
): Promise<bigint> {
  const accounts = { encoding: "base64" as const, addresses: [dev.toBase58()] };
  const [pre, sim] = await Promise.all([
    conn.getBalance(dev),
    conn.simulateTransaction(new VersionedTransaction(msg), {
      sigVerify: false,
      replaceRecentBlockhash: false,
      accounts,
    }),
  ]);
  const { err, logs } = sim.value;
  if (err !== null) {
    const out = simError(err, logs);
    if (out.error === "build_failed") throw buildFailed(`${JSON.stringify(err)} ${(logs ?? []).slice(-6)}`);
    throw fail(out);
  }
  const post = sim.value.accounts?.[0]?.lamports;
  if (post === undefined) throw buildFailed("simulation returned no dev account");
  return BigInt(pre) - BigInt(post);
}

const atLeast0 = (x: bigint): bigint => (x > 0n ? x : 0n);

// Burn: the dev pays solIn, the create rent and the fee. Sell differs from burn only by the SOL coming back,
// so solBack is the burn spend minus the sell spend of the same launch.
export function previewCosts(solIn: bigint, fee: bigint, burnSpent: bigint, sellSpent?: bigint) {
  return {
    createCost: atLeast0(burnSpent - solIn - fee),
    solBack: sellSpent === undefined ? null : atLeast0(burnSpent - sellSpent),
  };
}
