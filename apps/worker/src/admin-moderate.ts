// Moderation (ADMIN-07): hide a coin from every public list (D-29) and block a deployer from launching (D-30).
// Like admin-act, each change writes one landed audit row after validation and before the change (D-34); a
// refusal changes nothing and writes nothing. Refusals are answers, not errors, so the console can name them.
import type { ModerationResult } from "@bondr/core/api-admin";
import { blockedDeployers, coins, type Db, db, launches } from "@bondr/core/db";
import { PublicKey } from "@solana/web3.js";
import { eq, or, sql } from "drizzle-orm";
import type { AuditStore } from "./admin-audit.ts";
import { fail } from "./http.ts";

export type ModCoin = { mint: string; symbol: string; hiddenAt: Date | null };
export type ModStore = {
  // Coins whose mint equals the query or whose symbol matches it in any case.
  coinsBy(query: string): Promise<ModCoin[]>;
  setHidden(mint: string, reason: string | null): Promise<void>;
  block(wallet: string, reason: string): Promise<boolean>; // false: already blocked
  unblock(wallet: string): Promise<boolean>; // false: was not blocked
  isBlocked(wallet: string): Promise<boolean>;
};

const OPS = ["hide", "unhide", "block", "unblock"] as const;
export type ModOp = (typeof OPS)[number];
export type ModInput = {
  actor: string;
  op: ModOp;
  query?: string;
  mint?: string;
  wallet?: string;
  reason?: string;
};

type Exec = Pick<Db, "select" | "insert" | "update" | "delete">;

export function pgMod(exec: Exec = db()): ModStore {
  return {
    coinsBy: (query) =>
      exec
        .select({ mint: coins.mint, symbol: launches.symbol, hiddenAt: coins.hiddenAt })
        .from(coins)
        .innerJoin(launches, eq(launches.id, coins.launchId))
        .where(or(eq(coins.mint, query), sql`lower(${launches.symbol}) = lower(${query})`)),
    async setHidden(mint, reason) {
      const hiddenAt = reason === null ? null : new Date();
      await exec.update(coins).set({ hiddenAt, hiddenReason: reason }).where(eq(coins.mint, mint));
    },
    async block(wallet, reason) {
      const rows = await exec
        .insert(blockedDeployers)
        .values({ wallet, reason })
        .onConflictDoNothing()
        .returning({ wallet: blockedDeployers.wallet });
      return rows.length > 0;
    },
    async unblock(wallet) {
      const rows = await exec
        .delete(blockedDeployers)
        .where(eq(blockedDeployers.wallet, wallet))
        .returning({ wallet: blockedDeployers.wallet });
      return rows.length > 0;
    },
    isBlocked: (wallet) => blocked(exec, wallet),
  };
}

/** One indexed read: is this deployer blocked? prepare's admit runs it beside its other reads (D-30). */
export async function blocked(exec: Pick<Db, "select">, wallet: string): Promise<boolean> {
  const [r] = await exec
    .select({ wallet: blockedDeployers.wallet })
    .from(blockedDeployers)
    .where(eq(blockedDeployers.wallet, wallet))
    .limit(1);
  return !!r;
}

type MemCoin = ModCoin & { hiddenReason: string | null };

// Unit tests: the same matching and the same once-only block.
export function memoryMod(seed: ModCoin[] = []): ModStore & { coins: MemCoin[] } {
  const list: MemCoin[] = seed.map((c) => ({ ...c, hiddenReason: null }));
  const deny = new Map<string, string>();
  const q = (s: string) => s.toLowerCase();
  return {
    coins: list,
    coinsBy: async (query) =>
      list
        .filter((c) => c.mint === query || q(c.symbol) === q(query))
        .map(({ mint, symbol, hiddenAt }) => ({ mint, symbol, hiddenAt })),
    async setHidden(mint, reason) {
      const c = list.find((x) => x.mint === mint);
      if (c) Object.assign(c, { hiddenAt: reason === null ? null : new Date(), hiddenReason: reason });
    },
    block: async (wallet, reason) => !deny.has(wallet) && !!deny.set(wallet, reason),
    unblock: async (wallet) => deny.delete(wallet),
    isBlocked: async (wallet) => deny.has(wallet),
  };
}

const refuse = (reason: Exclude<ModerationResult, { ok: true }>["reason"], count?: number) =>
  ({ ok: false, reason, ...(count !== undefined && { count }) }) as ModerationResult;

// The DB CHECK allows 1 to 120 characters.
function reasonOf(v: string | undefined): string | null {
  const r = v?.trim() ?? "";
  return r && r.length <= 120 ? r : null;
}

function walletOf(v: string | undefined): string | null {
  try {
    return v && new PublicKey(v).toBase58() === v ? v : null;
  } catch {
    return null;
  }
}

// An exact mint wins over symbol matches. Unhide only considers hidden coins.
async function coinOp(s: ModStore, a: AuditStore, i: ModInput): Promise<ModerationResult> {
  const hiding = i.op === "hide";
  const reason = hiding ? reasonOf(i.reason) : null;
  if (hiding && !reason) return refuse("no_reason");
  const query = (i.mint ?? i.query ?? "").trim();
  const found = query ? await s.coinsBy(query) : [];
  const exact = found.filter((c) => c.mint === query);
  const pool = (exact.length ? exact : found).filter((c) => hiding || c.hiddenAt);
  const [c] = pool;
  if (!c) return refuse("no_match");
  if (pool.length > 1) return refuse("ambiguous", pool.length);
  if (hiding && c.hiddenAt) return refuse("already_hidden");
  const params = hiding ? { mint: c.mint, reason } : { mint: c.mint };
  await a.insertLanded({ actor: i.actor, action: i.op, mint: c.mint, params });
  await s.setHidden(c.mint, reason);
  return { ok: true };
}

// ponytail: the isBlocked read keeps the audit row ahead of the change; a racing second block still answers
// already_blocked through the insert's on conflict, with its audit row written. One owner, so no lock.
async function walletOp(s: ModStore, a: AuditStore, i: ModInput): Promise<ModerationResult> {
  const wallet = walletOf(i.wallet);
  if (!wallet) return refuse("invalid_wallet");
  const audit = (params: Record<string, unknown>) =>
    a.insertLanded({ actor: i.actor, action: i.op, mint: null, params: { wallet, ...params } });
  if (i.op === "unblock") {
    if (!(await s.isBlocked(wallet))) return refuse("no_match");
    await audit({});
    await s.unblock(wallet);
    return { ok: true };
  }
  const reason = reasonOf(i.reason);
  if (!reason) return refuse("no_reason");
  if (await s.isBlocked(wallet)) return refuse("already_blocked");
  await audit({ reason });
  return (await s.block(wallet, reason)) ? { ok: true } : refuse("already_blocked");
}

export function moderate(s: ModStore, a: AuditStore, i: ModInput): Promise<ModerationResult> {
  return i.op === "hide" || i.op === "unhide" ? coinOp(s, a, i) : walletOp(s, a, i);
}

const FIELDS = ["query", "mint", "wallet", "reason"] as const;
const MAX = 200; // far above any real field; longer reasons still answer no_reason below it

/** POST /admin/moderate's body, checked at the boundary: a known op and short strings, or 400. */
export function modReq(body: unknown): ModInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const op = OPS.find((o) => o === b.op);
  if (!op) throw fail({ error: "invalid_input" });
  const out: ModInput = { actor: String(b.actor), op };
  for (const f of FIELDS) {
    const v = b[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.length > MAX) throw fail({ error: "invalid_input" });
    out[f] = v;
  }
  return out;
}
