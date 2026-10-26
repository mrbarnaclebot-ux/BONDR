// The pure request rules of POST /prepare: parse and validate the body, the cheap guards, the sign window and
// the sell floor. Split out of prepare.ts to keep both files under the 300-line rule as the ticker cooldown and
// genesis paths join prepare; nothing here touches the chain or the database.
import type { ApiError, Exit, Links, PauseReason, PrepareRequest } from "@bondr/core/api";
import { applyBps } from "@bondr/core/math";
import {
  checkDescription,
  checkDevBuy,
  checkName,
  checkSymbol,
  checkUri,
  normalizeLink,
} from "@bondr/core/rules";
import { PublicKey } from "@solana/web3.js";
import { MAX_SOL_IN } from "./status.ts";

export type Req = Omit<PrepareRequest, "solIn"> & { solIn: bigint };
// New per-coin tables per hour, worker-wide: at about 0.006 SOL each, a cap on how fast prepare spam drains ops.
export const TABLE_CAP = 30;
// New tables per wallet per day: each coin needs its own table, so this is also a launch cap per wallet. It
// stops one proven wallet from spending the whole hourly cap (CR-01).
export const WALLET_TABLE_CAP = 10;
const SELL_SLIPPAGE_BPS = 300;
const CID = /^[A-Za-z0-9]{1,100}$/;
const LINK_KINDS = ["x", "telegram", "website"] as const;

export function walletOf(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 44) return null;
  try {
    return new PublicKey(raw).toBase58() === raw ? raw : null;
  } catch {
    return null;
  }
}

function linksOf(raw: unknown): Links | null {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object") return null;
  const out: Links = {};
  for (const kind of LINK_KINDS) {
    const v = (raw as Record<string, unknown>)[kind];
    if (v === undefined) continue;
    const r = typeof v === "string" ? normalizeLink(kind, v) : null;
    if (!r?.ok) return null;
    if (r.value) out[kind] = r.value;
  }
  return out;
}

function lamportsOf(raw: unknown, min: bigint): bigint | null {
  if (typeof raw !== "string" || !/^\d{1,20}$/.test(raw)) return null;
  const n = BigInt(raw);
  return n <= MAX_SOL_IN && checkDevBuy(n, min).ok ? n : null;
}

// The same rules as the browser and web (rules.ts), run again here: the worker trusts nothing it is sent.
export function parseRequest(body: unknown, min: bigint): Req | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const [name, symbol, uri] = [checkName(s("name")), checkSymbol(s("symbol")), checkUri(s("uri"))];
  const description = checkDescription(s("description"));
  const [wallet, links, solIn] = [walletOf(b.wallet), linksOf(b.links), lamportsOf(b.solIn, min)];
  const exit: Exit | null = b.exit === "burn" || b.exit === "sell" ? b.exit : null;
  if (!name.ok || !symbol.ok || !uri.ok || !description.ok || !CID.test(s("imageCid"))) return null;
  if (!wallet || !links || solIn === null || !exit) return null;
  const desc = description.value || undefined;
  const base = { wallet, name: name.value, symbol: symbol.value, uri: uri.value, links, solIn, exit };
  return { ...base, imageCid: s("imageCid"), ...(desc && { description: desc }) };
}

export type GuardInput = {
  paused: PauseReason | null;
  min: bigint | null; // null: the live config could not be read
  consented: boolean;
  body: unknown;
  tablesLastHour: number;
  walletTablesToday: number;
  reusable: boolean; // the wallet's live reservation already has a table
};

export function prepareGuard(i: GuardInput): ApiError | null {
  if (i.paused) return { error: "paused", paused: i.paused };
  if (i.min === null) return { error: "build_failed" };
  if (!parseRequest(i.body, i.min)) return { error: "invalid_input" };
  if (!i.consented) return { error: "consent_required" };
  const capped = i.tablesLastHour >= TABLE_CAP || i.walletTablesToday >= WALLET_TABLE_CAP;
  if (capped && !i.reusable) return { error: "rate_limited" };
  return null;
}

// Seconds left to sign at about 0.4 s per block, capped at 60 (Pitfall 3).
export const signBy = (lastValidBlockHeight: number, height: number): number =>
  Math.min(60, Math.max(0, Math.floor((lastValidBlockHeight - height) * 0.4)));

// The insta-sell floor: the simulated SOL back less 3%, never the 1-lamport default (T-02-11-05).
export function sellFloor(solBack: bigint): bigint {
  const floor = applyBps(solBack, 10_000 - SELL_SLIPPAGE_BPS);
  return floor > 0n ? floor : 1n;
}
