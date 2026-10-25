// The nightly reconciliation (FEE-09, D-21): each W's and the buyback's ledger-implied BONDR against the chain.
// It only reads and records, never moves funds: a difference is a reconcile_diff row (internal; Phase 6 reads
// it) and a Sentry error. Every amount is a meta delta, so the match is exact; BONDR sent to W from outside
// the ledger shows up as a diff by design.
import type { LedgerKind } from "@bondr/core/api";
import type { Db } from "@bondr/core/db";
import { reconcileDiff } from "@bondr/core/fees";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import type { Entry } from "./fee-ledger.ts";
import type { FeeCoin, FeeDeps } from "./fee-send.ts";

export type Implied = { byMint: Map<string, bigint>; buyback: bigint };
type Row = Pick<Entry, "kind" | "mint" | "amount" | "burned"> & { state: string | null };

// RESEARCH Reconciliation SQL; pgImplied is the same sums in one query.
const IN: LedgerKind[] = ["collect", "finalize_config", "finalize_update"];
const OUT: LedgerKind[] = ["split_treasury", "sweep_buyback", "sweep_treasury", "forced_bond", "pool_burn"];
const CHUNK = 100; // getMultipleAccountsInfo's limit

export function impliedOf(rows: Row[]): Implied {
  const out: Implied = { byMint: new Map(), buyback: 0n };
  for (const r of rows.filter((x) => x.state === "landed")) {
    const amount = r.amount ?? 0n;
    if (r.kind === "sweep_buyback") out.buyback += amount;
    if (r.kind === "buyback_burn") out.buyback -= r.burned ?? 0n;
    const sign = IN.includes(r.kind) ? 1n : OUT.includes(r.kind) ? -1n : 0n;
    if (r.mint && sign) out.byMint.set(r.mint, (out.byMint.get(r.mint) ?? 0n) + sign * amount);
  }
  return out;
}

// One round trip for every mint and the buyback (the batch's database read, D-03). The buyback row has mint null.
export async function pgImplied(c: Pick<Db, "execute">): Promise<Implied> {
  const rows = await c.execute<{ mint: string | null; implied: string }>(sql`
    select mint, sum(case when kind in ('collect','finalize_config','finalize_update') then amount
      else -amount end)::text as implied
    from fee_ledger where state = 'landed' and mint is not null and kind in ('collect','finalize_config',
      'finalize_update','split_treasury','sweep_buyback','sweep_treasury','forced_bond','pool_burn')
    group by mint
    union all
    select null, (coalesce(sum(amount) filter (where kind = 'sweep_buyback'), 0)
      - coalesce(sum(burned) filter (where kind = 'buyback_burn'), 0))::text
    from fee_ledger where state = 'landed' and kind in ('sweep_buyback','buyback_burn')`);
  const out: Implied = { byMint: new Map(), buyback: 0n };
  for (const r of rows) {
    if (r.mint === null) out.buyback = BigInt(r.implied);
    else out.byMint.set(r.mint, BigInt(r.implied));
  }
  return out;
}

// BONDR balances of the owners' ATAs, 100 per call; a missing ATA is 0.
async function balances(d: FeeDeps, owners: PublicKey[]): Promise<bigint[]> {
  const atas = owners.map((o) => getAssociatedTokenAddressSync(d.Q, o, true, T22));
  const out: bigint[] = [];
  for (let i = 0; i < atas.length; i += CHUNK)
    for (const info of await d.conn.getMultipleAccountsInfo(atas.slice(i, i + CHUNK)))
      out.push(info ? AccountLayout.decode(info.data).amount : 0n);
  return out;
}

// Mints the engine does not hold (another seed or lane) have no W here to read, so they are left out.
export async function reconcile(d: FeeDeps, coins: ReadonlyMap<string, FeeCoin>) {
  const implied = await d.ledger.implied();
  const wants = [...implied.byMint].flatMap(([mint, want]) => {
    const coin = coins.get(mint);
    return coin ? [{ mint: mint as string | null, want, owner: coin.w.publicKey }] : [];
  });
  wants.push({ mint: null, want: implied.buyback, owner: d.buyback.publicKey });
  const chain = await balances(
    d,
    wants.map((w) => w.owner),
  );
  let diffs = 0;
  for (const [i, { mint, want }] of wants.entries()) {
    const got = chain[i] ?? 0n;
    const diff = reconcileDiff(want, got);
    if (diff === null) continue;
    diffs++;
    console.error(`reconcile diff ${mint?.slice(0, 8) ?? "buyback"}: chain ${got}, ledger ${want}, ${diff}`);
    const detail = { implied: String(want), chain: String(got), diff: String(diff) };
    if (d.mode === "on") await d.ledger.diff(mint, detail);
  }
  console.log(`reconcile: ${wants.length} accounts, ${diffs} diffs`);
  return { accounts: wants.length, diffs };
}
