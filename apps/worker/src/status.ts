// The live values the launch form needs (fees, minimum, pause state, quote). Web never touches the chain
// (D-15), so every one of them comes from here. Read on demand and cached 5 s: no polling loop (Pitfall 6).
import type { PauseReason, Quote, Status } from "@bondr/core/api";
import { AwaitingMigration, creatorFeeFor, launchQuote, quoteVenue, type Venue } from "@bondr/core/launch";
import { estimateSolBack, minLamports } from "@bondr/core/math";
import { redact } from "@bondr/core/net";
import {
  BN,
  computeAmmFeesBps,
  computeFeesBps,
  type Global,
  newBondingCurve,
  OnlinePumpAmmSdk,
} from "@bondr/core/pump";
import { poolState } from "@bondr/core/trade";
import { NATIVE_MINT } from "@solana/spl-token";
import { type Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { type AuditStore, audited } from "./admin-audit.ts";
import { Fail, fail } from "./http.ts";
import { loadSwitches, setJob, switchesLoaded, switchOn } from "./switches.ts";

type Online = Parameters<typeof quoteVenue>[0];
type FeeConfig = Awaited<ReturnType<Online["fetchFeeConfig"]>>;
export type Ctx = {
  conn: Connection;
  online: Online;
  Q: PublicKey;
  priorityFee: number;
  net: "devnet" | "mainnet";
};
type Where = Venue | "awaiting" | null; // null: the chain read failed

const CACHE_MS = 5_000;
export const LAUNCH_CU_LIMIT = 600_000;
export const MAX_SOL_IN = 100n * BigInt(LAMPORTS_PER_SOL);

// Accounts a launch creates, read from the devnet launch.burn signature 2cYEyQd2JaHC...j134r (2026-10-19).
// The mint grows with name, symbol and URI; its 434 bytes held a 96-character URI. A Pinata dedicated gateway
// URI runs to about 120 characters, so 24 bytes are added; short names still overestimate a little.
const CREATE_ACCOUNT_SIZES = {
  mint: 458, // Token-2022 mint with its metadata
  bondingCurve: 166,
  curveChildAta: 170,
  curveBondrAta: 170,
  devChildAta: 170,
  devBondrAta: 170,
  vaultBondrAta: 170, // the child curve's BONDR fee vault
};

// D-18: a migrated BONDR is not a pause; only the seconds-long complete-but-unmigrated window is.
export function pauseReason(s: { enabled: boolean; venue: Where }): PauseReason | null {
  if (!s.enabled) return "kill_switch";
  return s.venue === "awaiting" ? "awaiting_migration" : null;
}

// Two signatures (dev and mint) plus the priority fee over the launch's compute limit.
export const networkFee = (microLamports: number): bigint =>
  2n * 5000n + (BigInt(microLamports) * BigInt(LAUNCH_CU_LIMIT)) / 1_000_000n;

// A fresh child curve quoted in BONDR at the creator fee the launch is built with (creatorFeeFor, D-01).
export function childFees(
  g: Global,
  fc: FeeConfig | null,
  Q: PublicKey,
  pq: Pick<NonNullable<Awaited<ReturnType<Online["fetchPumpQuote"]>>>, "curve">,
) {
  const creatorFeeBps = creatorFeeFor(g);
  const child = newBondingCurve(g, Q, pq.curve.quoteControl, creatorFeeBps, false, pq.curve);
  return computeFeesBps({
    global: g,
    feeConfig: fc,
    mintSupply: g.tokenTotalSupply,
    virtualQuoteReserves: child.virtualQuoteReserves,
    virtualTokenReserves: child.virtualTokenReserves,
    quoteMint: child.quoteMint,
    creatorFeeBps,
  });
}

const sum = (...bps: BN[]): number => bps.reduce((a, b) => a.add(b), new BN(0)).toNumber();

// Total fee bps of one SOL<->BONDR leg on BONDR's venue: protocol and creator on the curve, plus LP on the pool.
async function bondrLegBps(ctx: Ctx, venue: Venue, g: Global, fc: FeeConfig): Promise<number> {
  if (venue === "curve") {
    const c = await ctx.online.fetchBondingCurve(ctx.Q);
    const f = computeFeesBps({
      global: g,
      feeConfig: fc,
      mintSupply: c.tokenTotalSupply,
      virtualQuoteReserves: c.virtualQuoteReserves,
      virtualTokenReserves: c.virtualTokenReserves,
      quoteMint: c.quoteMint,
      creatorFeeBps: c.creatorFeeBps,
    });
    return sum(f.protocolFeeBps, f.creatorFeeBps);
  }
  const amm = new OnlinePumpAmmSdk(ctx.conn);
  const { state: s } = await poolState({ amm, mint: ctx.Q, quoteMint: NATIVE_MINT, user: PublicKey.default });
  const f = computeAmmFeesBps({
    globalConfig: s.globalConfig,
    feeConfig: s.feeConfig,
    creator: s.pool.creator,
    baseMintSupply: new BN(s.baseMintAccount.supply.toString()),
    baseMint: s.pool.baseMint,
    baseReserve: s.poolBaseAmount,
    quoteReserve: s.poolQuoteAmount,
    quoteMint: s.pool.quoteMint,
    isMayhemMode: s.pool.isMayhemMode,
    creatorFeeBps: s.pool.creatorFeeBps,
  });
  return sum(f.lpFeeBps, f.protocolFeeBps, f.creatorFeeBps);
}

export async function venueOf(ctx: Ctx): Promise<Venue | "awaiting"> {
  try {
    return await quoteVenue(ctx.online, ctx.Q);
  } catch (e) {
    if (e instanceof AwaitingMigration) return "awaiting";
    throw e;
  }
}

async function createCost(conn: Connection): Promise<bigint> {
  const sizes = Object.values(CREATE_ACCOUNT_SIZES);
  const rents = await Promise.all(sizes.map((n) => conn.getMinimumBalanceForRentExemption(n)));
  return rents.reduce((a, r) => a + BigInt(r), 0n);
}

async function readChain(ctx: Ctx) {
  const venue = await venueOf(ctx);
  const g = await ctx.online.fetchGlobal();
  const [fc, pq, cost] = await Promise.all([
    ctx.online.fetchFeeConfig(),
    ctx.online.fetchPumpQuote(ctx.Q, { global: g }),
    createCost(ctx.conn),
  ]);
  if (!pq) throw new Error(`fetchPumpQuote returned null for ${ctx.Q.toBase58()}`);
  const child = childFees(g, fc, ctx.Q, pq);
  const childBps = sum(child.protocolFeeBps, child.creatorFeeBps);
  const bondrBps = venue === "awaiting" ? null : await bondrLegBps(ctx, venue, g, fc);
  return {
    venue,
    fees: { protocolBps: child.protocolFeeBps.toNumber(), creatorBps: child.creatorFeeBps.toNumber() },
    min: minLamports(BigInt(g.initialVirtualSolReserves.toString())),
    cost,
    // Insta sell: SOL to BONDR, BONDR to child, child to BONDR, BONDR to SOL.
    legs: bondrBps === null ? null : [bondrBps, childBps, childBps, bondrBps],
  };
}

type Live = { status: Omit<Status, "paused">; venue: Where; legs: number[] | null };

async function readLive(ctx: Ctx): Promise<Live> {
  const chain = await readChain(ctx).catch((e: unknown) => {
    console.error(`status chain read failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    return null;
  });
  const status = {
    net: ctx.net, // explorer links and devnet-only hints follow it (row 14)
    quoteMint: ctx.Q.toBase58(),
    fees: chain?.fees ?? null,
    minLamports: chain ? String(chain.min) : null,
    createCostEstimate: chain ? String(chain.cost) : null,
    networkFeeEstimate: String(networkFee(ctx.priorityFee)),
  };
  return { status, venue: chain?.venue ?? null, legs: chain?.legs ?? null };
}

let cached: { at: number; live: Promise<Live> } | undefined;

// One shared promise per 5 s window, so concurrent polls cost one read; a failed read is not cached.
function live(ctx: Ctx): Promise<Live> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.live;
  const entry = { at: Date.now(), live: readLive(ctx) };
  cached = entry;
  entry.live.catch(() => {
    if (cached === entry) cached = undefined;
  });
  return entry.live;
}

export function parseSwitch(body: unknown): boolean {
  const on = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof on !== "boolean") throw new Fail(400, { error: "invalid_input" });
  return on;
}

// The runbook's bearer route (paused.e2e.ts uses it). WR-W-08: audited as actor "runbook" through the same
// writer as the console (D-34), and it never turns launches back on after EVACUATE; only the console does (D-36).
export async function setSwitch(body: unknown, audit: AuditStore): Promise<{ enabled: boolean }> {
  const on = parseSwitch(body);
  if (on && (await loadSwitches()).evacuatedAt) throw fail({ error: "not_applicable", reason: "evacuated" });
  const params = { job: "launches", enabled: on };
  await audited(audit, { actor: "runbook", action: "switch", mint: null, params }, () =>
    setJob("launches", on),
  );
  return { enabled: on };
}

// The launches switch lives in switches.ts memory, so the 10 s status poll of every open page never wakes Neon.
// fresh: prepare and submit re-read the settings row before they act on it, so a pause written in SQL still stops
// them; open pages show it after the next launch attempt or a restart.
export async function liveStatus(ctx: Ctx, fresh = false): Promise<Status> {
  const [l, enabled] = await Promise.all([
    live(ctx),
    fresh || !switchesLoaded() ? loadSwitches().then((s) => s.launches) : switchOn("launches"),
  ]);
  return { ...l.status, paused: pauseReason({ enabled, venue: l.venue }) };
}
function parseQuote(body: unknown): { solIn: bigint; wallet?: PublicKey } {
  const b = (body ?? {}) as { solIn?: unknown; wallet?: unknown };
  const bad = new Fail(400, { error: "invalid_input" });
  if (typeof b.solIn !== "string" || !/^\d{1,20}$/.test(b.solIn)) throw bad;
  const solIn = BigInt(b.solIn);
  if (solIn < 1n || solIn > MAX_SOL_IN) throw bad;
  if (b.wallet === undefined) return { solIn };
  if (typeof b.wallet !== "string") throw bad;
  try {
    return { solIn, wallet: new PublicKey(b.wallet) };
  } catch {
    throw bad;
  }
}

// Tokens the dev buy gets, a fee-only insta-sell estimate, and the balance only when the web passes a wallet
// (it does so only after consent, T-02-06-05).
export async function quote(ctx: Ctx, body: unknown): Promise<Quote> {
  const { solIn, wallet } = parseQuote(body);
  const { legs } = await live(ctx);
  const q = await launchQuote(ctx.online, ctx.Q, new BN(solIn.toString())).catch((e: unknown) => {
    if (e instanceof AwaitingMigration)
      throw new Fail(409, { error: "paused", paused: "awaiting_migration" });
    throw e;
  });
  if (!legs) throw new Error("live fee config unavailable");
  const out: Quote = {
    tokensOut: q.amount.toString(),
    solBackEstimate: String(estimateSolBack(solIn, legs)),
  };
  if (wallet) out.balance = String(await ctx.conn.getBalance(wallet));
  return out;
}
