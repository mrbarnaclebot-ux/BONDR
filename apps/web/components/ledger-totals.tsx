// UI-SPEC Fee ledger totals block (TOKEN-05): five cells that partition the coin's fees, pre-bond and bonded.
// Values come from the coin row (D-23) and update in place on each trade or fee event, with no flash.
import type { CoinFees } from "@bondr/core/api";
import { SUPPLY } from "@bondr/core/price";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { burnedPct, compact, feeSol, whole } from "@/lib/format";

const MUTED = "text-muted-foreground";

function Total(p: { label: string; tone?: string; sub: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", p.wide && "col-span-2 @min-[600px]:col-span-1")}>
      <dt className={cn("text-xs font-semibold tracking-[0.09em] uppercase", MUTED)}>{p.label}</dt>
      <dd className={cn("num text-base", p.tone)}>{p.children}</dd>
      <dd className={cn("text-xs", MUTED)}>{p.sub}</dd>
    </div>
  );
}

/** "0 SOL" muted at zero, "–" muted while the BONDR price is unknown. */
const solTotal = (lamports: string | null, base: string) =>
  BigInt(base) === 0n
    ? { tone: MUTED, text: "0 SOL" }
    : lamports === null
      ? { tone: MUTED, text: "–" }
      : { tone: undefined, text: `${feeSol(lamports)} SOL` };

type Cell = { label: string; tone?: string; text: string; sub: string };

/** Cell 2: the open window's budget before bond; after bond what the bond burn spent. */
function spentCell(f: CoinFees, bonded: boolean): Cell {
  if (!bonded)
    return {
      label: "In burn budget",
      ...solTotal(f.budgetSol, f.budget),
      sub: `${whole(f.budget)} BONDR, this window`,
    };
  if (!f.bondKind) return { label: "Bond burn buy", tone: MUTED, text: "0 SOL", sub: "Nothing spent yet" };
  const [label, where] =
    f.bondKind === "forced" ? ["Forced-bond buy", "the curve"] : ["Fallback buy", "PumpSwap"];
  return {
    label,
    ...solTotal(f.bondSpentSol, f.bondSpent),
    sub: `${whole(f.bondSpent)} BONDR spent on ${where}`,
  };
}

/** Cell 5: the deployer's share; only a finalized coin has earned anything, and a held one is plain. */
function deployerCell(f: CoinFees, bonded: boolean): Cell {
  if (!bonded)
    return { label: "Deployer share", tone: MUTED, text: "After bond", sub: "80% of fees once finalized" };
  if (f.finalize !== "done") {
    const text = f.finalize === "held" ? "Pending review" : "Pending";
    return { label: "Deployer share", tone: MUTED, text, sub: "80% once finalized" };
  }
  const d = f.deployerBps === null ? "–" : String(f.deployerBps / 100);
  return {
    label: "Deployer earned",
    ...solTotal(f.deployerEarnedSol, f.deployerEarned),
    sub: `${d}% of post-bond fees`,
  };
}

/** UI-SPEC Totals block: the buckets account for every collected BONDR, before and after the bond. */
export function Totals({ f, symbol, bonded }: { f: CoinFees; symbol: string; bonded: boolean }) {
  const burned = BigInt(f.burnedSupply) > 0n;
  const [buyback, treasury] = [
    solTotal(f.toBuybackSol, f.toBuyback),
    solTotal(f.toTreasurySol, f.toTreasury),
  ];
  const share = bonded ? "10% before bond, 20% after" : "the 10% share";
  const cells: (Cell & { wide?: boolean })[] = [
    {
      label: "Supply burned",
      tone: burned ? "text-leaf" : MUTED,
      text: burnedPct(f.burnedSupply, SUPPLY),
      sub: burned ? `${compact(f.burnedSupply)} ${symbol} burned` : "Nothing burned yet",
    },
    spentCell(f, bonded),
    { label: "To buyback", ...buyback, sub: `${whole(f.toBuyback)} BONDR swept for the burn` },
    { label: "To treasury", ...treasury, sub: `${whole(f.toTreasury)} BONDR${bonded ? ":" : ","} ${share}` },
    { ...deployerCell(f, bonded), wide: true },
  ];
  return (
    <dl className="mb-4 grid grid-cols-2 gap-4 border-b border-dashed border-line-strong pb-4 @min-[600px]:grid-cols-3 @min-[880px]:grid-cols-5">
      {cells.map(({ text, ...c }) => (
        <Total key={c.label} {...c}>
          {text}
        </Total>
      ))}
    </dl>
  );
}
