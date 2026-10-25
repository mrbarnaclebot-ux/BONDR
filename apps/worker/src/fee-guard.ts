// The guard every balance-sized send passes (CR-01): the window and closing sweeps, the forced bond and the
// pool burn all spend W's live BONDR balance, which is all budget only once no collect, split or bond burn of
// the coin is pending and every landed collect has its split. Sent any earlier, they would sweep or burn the
// treasury tenth. Pending rows are settled from chain first, exactly as at boot. The window job lives here as
// the guard's most frequent caller (fee-prebond holds the split the guard needs).
import type { LedgerKind } from "@bondr/core/api";
import { collectJob, settled, splitJob, sweepJob, worthCollecting } from "./fee-prebond.ts";
import { settleRows } from "./fee-recover.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

const HOLDS: LedgerKind[] = ["collect", "split_treasury", "forced_bond", "pool_burn"];
const DEFERRED: Landed = { state: "unknown" };

// The splits it sent, then DEFERRED while any row is still pending. Dry mode writes nothing, so its pending
// rows stay as they are, as at boot.
async function guard(d: FeeDeps, coin: FeeCoin, urgent: boolean): Promise<Landed[]> {
  const mint = coin.mint.toBase58();
  const held = await d.ledger.pendingFor(mint, HOLDS);
  const left = held.length && d.mode === "on" ? await settleRows(d, held, () => coin) : held.length;
  const out: Landed[] = [];
  for (const c of await d.ledger.openCollects(mint)) out.push(await splitJob(d, coin, c, urgent));
  if (!left) return out;
  console.error(`fee ${mint}: ${left} collect, split or bond burn pending, balance-sized send deferred`);
  return [...out, DEFERRED];
}

// Appends the guard's results to the steps already run, then the send only when every one of them settled.
export async function spend(
  d: FeeDeps,
  coin: FeeCoin,
  out: Landed[],
  send: () => Promise<Landed>,
  urgent = false,
): Promise<Landed[]> {
  out.push(...(await guard(d, coin, urgent)));
  if (out.every(settled)) out.push(await send());
  return out;
}

// Window end (D-10, D-12): collect, split every open collect of this coin, then sweep.
export async function windowJob(d: FeeDeps, coin: FeeCoin, index: number): Promise<Landed[]> {
  const out = worthCollecting(d, coin) ? [await collectJob(d, coin)] : [];
  return spend(d, coin, out, () => sweepJob(d, coin, index));
}
