// UI-SPEC Fee ledger row copy: tag, tone, description and amount cell per public kind. Pure, so the unit test
// can load it. Only PUBLIC_KINDS have copy; an internal row has nothing to render.
import type { Exit, LedgerRow, PublicKind } from "@bondr/core/api";
import { compact, feeSol, pct, sol, thousands } from "./format";

export type Tone = "plain" | "mint" | "warn" | "leaf";
type Entry = {
  tag: string;
  tone: Tone;
  text(r: LedgerRow, symbol: string): string;
  value?(r: LedgerRow): string;
};
export type Copy = { tag: string; tone: Tone; text: string; value: string | null };

/** BONDR base units (6 decimals) in whole units with thousands separators. */
const bondr = (r: LedgerRow) => thousands(BigInt(r.amount ?? "0") / 1_000_000n);
const tokens = (r: LedgerRow) => compact(r.burned ?? "0");
const win = (r: LedgerRow) => (r.windowIndex ?? 0) + 1;
const bps = (n?: number) => (n === undefined ? "–" : String(n));
const share = (n?: number) => (n === undefined ? "–" : pct(n, true));

const SWEPT = (r: LedgerRow) => `Window ${win(r)} closed unbonded. Swept ${bondr(r)} BONDR`;

export const COPY: Record<PublicKind, Entry> = {
  collect: {
    tag: "Collect",
    tone: "plain",
    text: (r) => `Claimed ${bondr(r)} BONDR of creator fees from pump into the fee wallet.`,
  },
  split_treasury: {
    tag: "Split 90/10",
    tone: "mint",
    text: (r) =>
      `Sent ${bondr(r)} BONDR, the 10% share, to treasury. The other 90% stays in the fee wallet as burn budget.`,
  },
  sweep_buyback: {
    tag: "Sweep",
    tone: "warn",
    text: (r) => `${SWEPT(r)}, 90% of the budget, to the BONDR buyback for burning.`,
  },
  sweep_treasury: {
    tag: "Sweep",
    tone: "warn",
    text: (r) => `${SWEPT(r)}, 10% of the budget, to treasury.`,
  },
  forced_bond: {
    tag: "Forced bond",
    tone: "leaf",
    text: (r, s) =>
      `Burned ${tokens(r)} ${s}. The burn budget bought the rest of the curve with ${bondr(r)} BONDR and burned it in the same transaction.`,
  },
  pool_burn: {
    tag: "Fallback burn",
    tone: "leaf",
    text: (r, s) =>
      `Burned ${tokens(r)} ${s}. Traders bonded first, so the burn budget bought on PumpSwap with ${bondr(r)} BONDR and burned it in the same transaction.`,
  },
  finalize_config: {
    tag: "Finalize",
    tone: "mint",
    text: (r, s) =>
      `Set up fee sharing for ${s} with the deployer and treasury as recipients${r.amount === null ? "" : ", after sweeping pending fees"}.`,
  },
  finalize_update: {
    tag: "Finalize 80/20",
    tone: "mint",
    text: (r) =>
      `Fee shares set once: deployer ${bps(r.detail?.dBps)}, treasury ${bps(r.detail?.tBps)} bps, with update_fee_shares_v2. Pump locks them for good.`,
    value: (r) => `${bps(r.detail?.dBps)} / ${bps(r.detail?.tBps)} bps`,
  },
  distribute: {
    tag: "Distribute",
    tone: "mint",
    text: (r) =>
      `Paid ${bondr(r)} BONDR of post-bond creator fees, ${share(r.detail?.dBps)} to the deployer and ${share(r.detail?.tBps)} to treasury.`,
  },
};

/** A row this build has copy for. The worker deploys apart from web, so a live row can carry a kind added later. */
export const known = (r: { kind: string }): r is LedgerRow => Object.hasOwn(COPY, r.kind);

/** A landed row's copy; the amount cell is the kind's special value, else the stored SOL value, else none. */
export function ledgerCopy(r: LedgerRow, symbol: string): Copy {
  const e = COPY[r.kind];
  const value = e.value ? e.value(r) : r.sol === null ? null : `${feeSol(r.sol)} SOL`;
  return { tag: e.tag, tone: e.tone, text: e.text(r, symbol), value };
}

/** The synthesized launch row, always the oldest entry (it is not a fee_ledger row). */
export function launchCopy(l: { exit: Exit; solIn: string; tokens?: string; symbol: string }): Copy {
  const value = `${sol(l.solIn)} SOL`;
  if (l.exit === "sell")
    return {
      tag: "Launch sell",
      tone: "plain",
      text: `Dev buy of ${value} sold back in the launch transaction (insta sell). The deployer kept the SOL, not the tokens.`,
      value,
    };
  const got = l.tokens ? ` (${compact(l.tokens)} ${l.symbol})` : "";
  return {
    tag: "Launch burn",
    tone: "leaf",
    text: `Dev buy of ${value}${got} burned in the launch transaction (insta burn).`,
    value,
  };
}
