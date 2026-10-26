// The transaction inspector (ADMIN-09, D-32): one getTransaction, each top-level instruction decoded by its
// program, the failure mapped through trade-error.ts. RPC only, never Postgres. It answers labelled strings, so
// no program id or raw log line reaches the browser (check-client-bundle.sh, T-06-21-02).
import type { AdminInspect } from "@bondr/core/api-admin";
import { getPumpAmmProgram, getPumpFeeProgram, getPumpProgram } from "@bondr/core/pump";
import { customCode, fromLogs, tradeError } from "@bondr/core/trade-error";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
} from "@solana/spl-token";
import {
  type AccountMeta,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Connection,
  type PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { buyback, ops, treasury, type WorkerEnv } from "./env.ts";
import type { Engine } from "./fee-engine.ts";

export type Known = Map<string, { label: string; mint?: string }>;
type Decoded = { program: string; name: string; args: string[] };
type Body = Omit<Decoded, "program">;
type Decoder = (ix: TransactionInstruction) => Body;

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
// PublicKey, bigint, number and bn.js all print as their plain value through String().
const lines = (o: object): string[] => Object.entries(o).map(([k, v]) => `${k}: ${String(v)}`);

// web3.js names a few System types differently from their decoders (Create -> decodeCreateAccount).
const SYS: Record<string, string> = {
  Create: "CreateAccount",
  AdvanceNonceAccount: "NonceAdvance",
  WithdrawNonceAccount: "NonceWithdraw",
  InitializeNonceAccount: "NonceInitialize",
  AuthorizeNonceAccount: "NonceAuthorize",
};
type Statics = Record<string, ((ix: TransactionInstruction) => object) | undefined>;
// The static decoders read `this`, so each is called on its class. A type with no decoder keeps its name.
function web3(cls: object, name: string, ix: TransactionInstruction): Body {
  const decode = (cls as Statics)[`decode${name}`];
  return { name, args: decode ? lines(decode.call(cls, ix)) : [] };
}
const system: Decoder = (ix) => {
  const type = SystemInstruction.decodeInstructionType(ix);
  return web3(SystemInstruction, SYS[type] ?? type, ix);
};
const budget: Decoder = (ix) =>
  web3(ComputeBudgetInstruction, ComputeBudgetInstruction.decodeInstructionType(ix), ix);

// spl-token decodes the base instructions only; an extension instruction keeps its name without arguments.
const token: Decoder = (ix) => {
  try {
    const d = decodeInstruction(ix, ix.programId);
    const { instruction, ...data } = d.data as { instruction: number };
    const keys = Object.entries(d.keys as Record<string, AccountMeta | AccountMeta[] | null>)
      .filter(([k, v]) => k !== "multiSigners" && v)
      .map(([k, v]) => `${k}: ${(v as AccountMeta).pubkey.toBase58()}`);
    return { name: TokenInstruction[instruction], args: [...keys, ...lines(data)] };
  } catch {
    return { name: TokenInstruction[ix.data[0]] ?? "Undecoded", args: [] };
  }
};

const ATA = ["Create", "CreateIdempotent", "RecoverNested"];
const ata: Decoder = (ix) => {
  const name = ATA[ix.data[0] ?? 0] ?? "Undecoded";
  const [payer, account, owner, mint] = ix.keys.map((k) => k.pubkey.toBase58());
  return { name, args: name === "RecoverNested" ? [] : lines({ payer, account, owner, mint }) };
};

// Program types its coder as the encode-only interface; at runtime it is anchor's BorshInstructionCoder.
type Ix = { name: string; data: object };
type IxCoder = {
  decode(data: Buffer): Ix | null;
  format(ix: Ix, metas: AccountMeta[]): { args: { name: string; data: string }[] } | null;
};
const anchor =
  (program: { coder: { instruction: unknown } }): Decoder =>
  (ix) => {
    const coder = program.coder.instruction as IxCoder;
    const d = coder.decode(Buffer.from(ix.data));
    if (!d) return { name: "Undecoded", args: [] };
    return { name: d.name, args: coder.format(d, ix.keys)?.args.map((a) => `${a.name}: ${a.data}`) ?? [] };
  };

// Built once per process. The coders never read the chain, so an offline Connection builds them.
let programs: Map<string, { label: string; decode: Decoder }> | undefined;
function programsOf() {
  const offline = new Connection("http://127.0.0.1:1");
  const [pump, amm, fees] = [getPumpProgram, getPumpAmmProgram, getPumpFeeProgram].map((get) => get(offline));
  const rows: [PublicKey, string, Decoder][] = [
    [SystemProgram.programId, "System", system],
    [TOKEN_PROGRAM_ID, "Token", token],
    [TOKEN_2022_PROGRAM_ID, "Token-2022", token],
    [ASSOCIATED_TOKEN_PROGRAM_ID, "Associated Token", ata],
    [ComputeBudgetProgram.programId, "Compute Budget", budget],
    [pump.programId, "pump", anchor(pump)],
    [amm.programId, "pump-amm", anchor(amm)],
    [fees.programId, "pump-fees", anchor(fees)],
  ];
  programs = new Map(rows.map(([id, label, decode]) => [id.toBase58(), { label, decode }]));
  return programs;
}

// T-06-21-04: crafted data never throws out of here; it reads as an undecoded line.
export function decodeIx(ix: TransactionInstruction): Decoded {
  const id = ix.programId.toBase58();
  const p = (programs ?? programsOf()).get(id);
  if (!p) return { program: `Unknown program ${short(id)}`, name: "", args: [] };
  try {
    return { program: p.label, ...p.decode(ix) };
  } catch {
    return { program: p.label, name: "Undecoded", args: [] };
  }
}

// The contract label first, then the instruction, code and IDL name; never the raw log text.
function errorOf(err: unknown, logs: string[] | null): string | null {
  if (!err) return null;
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  const { code: logged, name } = fromLogs(logs);
  const code = customCode(err) ?? logged;
  const raw = typeof ie?.[1] === "string" ? ie[1] : typeof err === "string" ? err : "";
  const kind = /^\w+$/.test(raw) ? raw : undefined;
  const why = code === undefined ? kind : `code ${code}${name ? ` ${name}` : ""}`;
  const detail = [ie && `#${ie[0] + 1}`, why].filter(Boolean).join(", ");
  const label = tradeError(err, logs).error;
  return detail ? `${label} (${detail})` : label;
}

function instructionsOf(tx: VersionedTransactionResponse): AdminInspect["instructions"] {
  const msg = tx.transaction.message;
  const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
  return msg.compiledInstructions.map((c, i) => {
    const ix = new TransactionInstruction({
      programId: keys.get(c.programIdIndex) as PublicKey,
      keys: c.accountKeyIndexes.map((k) => ({
        pubkey: keys.get(k) as PublicKey,
        isSigner: msg.isAccountSigner(k),
        isWritable: msg.isAccountWritable(k),
      })),
      data: Buffer.from(c.data),
    });
    return { index: i + 1, ...decodeIx(ix) };
  });
}

// A dead RPC rejects; the route answers 503 rpc_failed. null means this RPC does not have it.
export async function inspect(conn: Connection, sig: string, known: Known): Promise<AdminInspect> {
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
  if (!tx) return { found: false };
  const payer = tx.transaction.message.staticAccountKeys[0].toBase58();
  return {
    found: true,
    status: tx.meta?.err ? "failed" : "success",
    slot: tx.slot,
    feePayer: { label: "", ...known.get(payer), address: payer },
    instructions: instructionsOf(tx),
    error: errorOf(tx.meta?.err, tx.meta?.logMessages ?? null),
    explorer: `https://solscan.io/tx/${sig}?cluster=devnet`, // devnet only: env refuses mainnet
  };
}

// The worker's own wallets and every engine coin's W (with its mint) name a fee payer.
export function knownKeys(env: WorkerEnv, engine: Pick<Engine, "coins"> | null): Known {
  const { seed, net, lane } = env;
  const known: Known = new Map([
    [ops(seed, net).publicKey.toBase58(), { label: "ops" }],
    [treasury(seed, net).publicKey.toBase58(), { label: "treasury" }],
    [buyback(seed, net, lane).publicKey.toBase58(), { label: "buyback" }],
  ]);
  for (const [mint, coin] of engine?.coins ?? [])
    known.set(coin.w.publicKey.toBase58(), { label: "W", mint });
  return known;
}
