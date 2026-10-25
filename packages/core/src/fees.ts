// Pure bigint fee rules. No SDK import, so the window, budget, sweep and totals rules are unit-testable offline
// and web may import them.
import type { LedgerKind, PublicKind } from "./api.ts";
import { split90_10 } from "./math.ts";

// The kinds a public read returns; web and worker both filter by this one list. The platform buyback burn,
// held and reconcile_diff rows stay internal.
export const PUBLIC_KINDS = [
  "collect",
  "split_treasury",
  "sweep_buyback",
  "sweep_treasury",
  "forced_bond",
  "pool_burn",
  "finalize_config",
  "finalize_update",
  "distribute",
  "leftover_burn",
  "evacuate",
] as const satisfies readonly PublicKind[];

// D-10, D-12: windows run from launch, derived and never stored, so a restart loses nothing.
export function windowOf(launchedAt: number, now: number, windowMs: number): number {
  if (!(windowMs > 0)) throw new Error(`bad window: ${windowMs}`);
  return now < launchedAt ? 0 : Math.floor((now - launchedAt) / windowMs);
}

export const windowEnd = (launchedAt: number, index: number, windowMs: number): number =>
  launchedAt + (index + 1) * windowMs;

// D-15: the budget counts the unclaimed bucket at the share a collect and split would leave in W.
export const budgetOf = (feeBudget: bigint, feesUnclaimed: bigint): bigint =>
  feeBudget + split90_10(feesUnclaimed).burn;

// D-12, D-14: the sweep uses the split's floor, so dust stays with the buyback.
export function sweepSplit(x: bigint): { buyback: bigint; treasury: bigint } {
  const { treasury, burn } = split90_10(x);
  return { buyback: burn, treasury };
}

// WR-08: the simulated post balance includes any child tokens W held before, so minOut is the difference.
export function minOutAfter(pre: bigint, simOut: bigint): bigint {
  if (simOut <= pre) throw new Error(`simulated out ${simOut} not above ${pre}`);
  return simOut - pre;
}

// D-18: the permanent 80/20 goes to the launch wallet only, never to the treasury, W or another platform key
// (ops, buyback), and only on curve.
export function deployerOk(a: {
  deployer: string;
  wallet: string;
  treasury: string;
  w: string;
  platform: string[];
  onCurve: boolean;
}): string | null {
  if (a.deployer !== a.wallet) return "deployer is not the launch wallet";
  if (a.deployer === a.treasury) return "deployer is the treasury";
  if (a.deployer === a.w) return "deployer is the fee wallet";
  if (a.treasury === a.w) return "treasury is the fee wallet";
  if (a.platform.includes(a.deployer)) return "deployer is a platform key";
  if (!a.onCurve) return "deployer is off curve";
  return null;
}

// D-19: distribute only when the ops fee is under 1% of the payout.
export const distributeMin = (feeLamports: number): bigint => BigInt(feeLamports) * 100n;

export type TotalColumn =
  | "fee_budget"
  | "to_buyback"
  | "to_buyback_sol"
  | "to_treasury"
  | "to_treasury_sol"
  | "bond_spent"
  | "bond_spent_sol"
  | "bond_burned"
  | "deployer_earned"
  | "deployer_earned_sol";

export type Totals = {
  add: Partial<Record<TotalColumn, bigint>>;
  set?: { feesUnclaimed?: 0n; finalize?: "done"; deployerBps?: number };
};

export type LandedRow = {
  amount?: bigint | null;
  burned?: bigint | null;
  sol?: bigint | null;
  detail?: { dBps?: number; deployerAmount?: string; treasuryAmount?: string } | null;
};

// A distribute's SOL value splits in proportion to its two shares; the treasury takes the rounding.
function distributeTotals(r: LandedRow): Totals {
  const d = BigInt(r.detail?.deployerAmount ?? "0");
  const t = BigInt(r.detail?.treasuryAmount ?? "0");
  const sol = r.sol ?? 0n;
  const dSol = d + t > 0n ? (sol * d) / (d + t) : 0n;
  return {
    add: { deployer_earned: d, deployer_earned_sol: dSol, to_treasury: t, to_treasury_sol: sol - dSol },
  };
}

// D-23, Pattern 8: the coin column changes one landed row makes, applied in the transaction that lands it.
// fee_budget deltas may be negative; the store clamps fee_budget at 0 (W can receive BONDR outside the
// ledger, and D-21's reconcile reports it). Every other total only grows, so coins_fee_totals catches a bug.
export function totalsFor(kind: LedgerKind, r: LandedRow): Totals {
  const [amount, sol] = [r.amount ?? 0n, r.sol ?? 0n];
  switch (kind) {
    case "collect":
      return { add: { fee_budget: amount }, set: { feesUnclaimed: 0n } };
    case "split_treasury":
    case "sweep_treasury":
      return { add: { fee_budget: -amount, to_treasury: amount, to_treasury_sol: sol } };
    case "sweep_buyback":
      return { add: { fee_budget: -amount, to_buyback: amount, to_buyback_sol: sol } };
    case "forced_bond":
    case "pool_burn":
      return {
        add: { fee_budget: -amount, bond_spent: amount, bond_spent_sol: sol, bond_burned: r.burned ?? 0n },
      };
    case "distribute":
      return distributeTotals(r);
    case "leftover_burn": // D-17: child tokens, not BONDR, so only Supply burned moves (UI-SPEC item 12)
      return { add: { bond_burned: r.burned ?? 0n } };
    case "evacuate": // D-36: an emergency move to treasury, the sweep_treasury shape (UI-SPEC item 12)
      return { add: { fee_budget: -amount, to_treasury: amount, to_treasury_sol: sol } };
    case "finalize_config":
      return { add: { fee_budget: amount } };
    case "finalize_update":
      return { add: { fee_budget: amount }, set: { finalize: "done", deployerBps: r.detail?.dBps } };
    default:
      return { add: {} }; // buyback_burn, held, reconcile_diff
  }
}

// D-21: the nightly reconcile reports chain minus ledger-implied, or null on an exact match.
export const reconcileDiff = (implied: bigint, chain: bigint): bigint | null =>
  chain === implied ? null : chain - implied;
