// Leftover recovery after finalize (ADMIN-03, D-16, D-17, Phase 5 WR-08): W's leftover child tokens are burned,
// never held, and W's empty token accounts close with their rent to the treasury. Each step is one tx through
// d.land (intent row first, never resent while unknown), so admin deps and finalize run them like any fee job.
import type { LedgerKind } from "@bondr/core/api";
import { windowOf } from "@bondr/core/fees";
import { COIN_DECIMALS } from "@bondr/core/launch";
import {
  AccountLayout,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { spend } from "./fee-guard.ts";
import { settled, sweepJob, wBondr } from "./fee-prebond.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

const DONE: Landed = { state: "done" };
const SWEEPS: LedgerKind[] = ["sweep_buyback", "sweep_treasury"];

// D-17, T-06-09-02: W's whole child balance in one BurnChecked signed by W, ops paying. The row carries only
// burned: child tokens are not BONDR, so no amount or SOL value (totalsFor adds it to Supply burned).
export async function leftoverBurnJob(d: FeeDeps, coin: FeeCoin): Promise<Landed> {
  const w = coin.w.publicKey;
  const amount = await wBondr(d, coin, coin.mint);
  if (amount === 0n) return DONE;
  const ata = getAssociatedTokenAddressSync(coin.mint, w, true, T22);
  const ix = createBurnCheckedInstruction(ata, coin.mint, w, amount, COIN_DECIMALS, [], T22);
  const row = { kind: "leftover_burn" as const, mint: coin.mint.toBase58(), burned: amount };
  return d.land({ rows: [row], ixs: [ix], signers: [coin.w] });
}

// T-06-09-01: W's BONDR and child accounts that exist with 0 balance close to the treasury, in one W-signed tx.
// No ledger row: closing moves only rent, which the admin audit records.
export async function closeAccountsJob(d: FeeDeps, coin: FeeCoin): Promise<Landed> {
  const w = coin.w.publicKey;
  const atas = [d.Q, coin.mint].map((m) => getAssociatedTokenAddressSync(m, w, true, T22));
  const infos = await d.conn.getMultipleAccountsInfo(atas);
  const empty = atas.filter((_, i) => {
    const info = infos[i];
    return info && AccountLayout.decode(info.data).amount === 0n;
  });
  if (!empty.length) return DONE;
  const ixs = empty.map((ata) => createCloseAccountInstruction(ata, d.treasury, w, [], T22));
  return d.land({ rows: [], ixs, signers: [coin.w] });
}

// A9, Pitfall 7: the lowest window index at or after the current one with no live sweep row, so the leftover
// sweep never collides with finalize's closing sweep or a window's own (the unique index would send nothing).
async function freeWindow(d: FeeDeps, coin: FeeCoin): Promise<number> {
  const mint = coin.mint.toBase58();
  let i = windowOf(coin.launchedAt, Date.now(), d.windowMs);
  while (await d.ledger.has(mint, SWEEPS, i)) i++;
  return i;
}

// D-16 "Sweep leftovers, close accounts": BONDR swept 90/10 through the spend guard, child tokens burned, then
// the empty accounts closed. Each step runs only when the one before settled, so a failed burn closes nothing.
export async function sweepLeftoversJob(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  coin.open = true; // an owner run: the guard reads Postgres even for a coin idle since boot
  const index = await freeWindow(d, coin);
  const out = await spend(d, coin, [], () => sweepJob(d, coin, index));
  for (const step of [leftoverBurnJob, closeAccountsJob]) {
    if (!out.every(settled)) return out;
    out.push(await step(d, coin));
  }
  return out;
}
