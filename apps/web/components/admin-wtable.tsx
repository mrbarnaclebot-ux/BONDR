"use client";
// UI-SPEC Fee wallets (W) table (ADMIN-02, D-23, D-24): every coin from the one overview load, its state and
// next step from admin-state.ts. No chain read per row: the budget is the coin row's fee_budget (D-23), and
// filtering, sorting and Show all work on data already loaded.
import type { Net } from "@bondr/core/api";
import { budgetOf } from "@bondr/core/fees";
import { ArrowUpRight } from "lucide-react";
import { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import type { AdminOverview } from "@/lib/admin-data";
import {
  budgetSol,
  CHIPS,
  chipCounts,
  type WChip,
  type WItem,
  wItems,
  windowMsLeft,
} from "@/lib/admin-state";
import { cn } from "@/lib/cn";
import { age, explorer, feeSol, ratio1000, ratioPct, short, windowLeft } from "@/lib/format";
import { imageUrl } from "@/lib/pinata";
import { Panel } from "./admin-panel";
import { Tag } from "./tag";
import { Chips } from "./trade-amount";
import { Button } from "./ui-button";

const FIRST = 50; // T-06-16-02: 500 rows at once would bury the timeline; the rest show on click
const HEADS = ["Coin", "State", "Next step", "Burn budget", "vs cost", "Window left", "Last collect", "W"];
const RIGHT = new Set(["Burn budget", "vs cost", "Window left"]);
const TH = "py-2 pr-4 text-left font-semibold tracking-[0.05em] uppercase";
const TD = "border-t border-line py-2 pr-4";
// The sticky Coin column needs an opaque fill so cells scrolling under it stay readable.
const STICKY = "sticky left-0 z-10 border-r border-line bg-surface pl-0";
const MUTED = "text-muted-foreground";
// relative: the sr-only link text is absolutely positioned and would otherwise widen the page, not the region.
const REGION = "relative overflow-x-auto border-t border-line-strong";

type Filter = "All" | WChip;
type Props = {
  overview: AdminOverview;
  busy: boolean;
  windowMs: number;
  selected: string | null;
  onSelect(mint: string): void;
};

const hide = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.hidden = true;
};

function CoinCell({ i, current, onSelect }: { i: WItem; current: boolean; onSelect(mint: string): void }) {
  const src = imageUrl(i.row.image);
  return (
    <td className={cn(TD, STICKY, current && "bg-surface-2")}>
      <span className="flex items-center gap-2 pl-2">
        <span className="size-6 flex-none overflow-hidden rounded-full bg-surface-2">
          {src && <img src={src} alt="" loading="lazy" className="size-6 object-cover" onError={hide} />}
        </span>
        <button
          type="button"
          aria-label={`${i.row.symbol}, open timeline`}
          aria-current={current ? "true" : undefined}
          onClick={() => onSelect(i.row.mint)}
          className="min-h-11 cursor-pointer text-left text-[13px] font-semibold text-mint decoration-1 underline-offset-[3px] hover:underline md:min-h-6"
        >
          {i.row.symbol}
        </button>
      </span>
    </td>
  );
}

function Num({ text, className }: { text: string; className?: string }) {
  return <td className={cn(TD, "num text-right", className)}>{text}</td>;
}

function Budget({ i }: { i: WItem }) {
  const v = budgetSol(i.row);
  if (v === 0n) return <Num text="0" className={MUTED} />;
  return v === null ? <Num text="–" className={MUTED} /> : <Num text={`${feeSol(v.toString())} SOL`} />;
}

function Row({ i, now, windowMs, net, current, onSelect }: RowProps) {
  const r = i.row;
  const curve = r.venue === "curve" && r.launch === "landed";
  const budget = budgetOf(BigInt(r.feeBudget), BigInt(r.feesUnclaimed)).toString();
  const ratio = ratio1000(budget, r.cost);
  return (
    <tr className={cn("transition-colors duration-(--dur) hover:bg-surface-2/60", current && "bg-surface-2")}>
      <CoinCell i={i} current={current} onSelect={onSelect} />
      <td className={TD}>
        <Tag tone={i.state.tone}>{i.state.label}</Tag>
      </td>
      <td className={cn(TD, "text-[13px] whitespace-nowrap")}>{i.state.next}</td>
      <Budget i={i} />
      {curve ? (
        <Num text={ratioPct(budget, r.cost)} className={cn(ratio !== null && ratio >= 1050 && "text-leaf")} />
      ) : (
        <Num text="–" className={MUTED} />
      )}
      <Num text={curve ? windowLeft(windowMsLeft(r, now, windowMs)) : "–"} className={cn(!curve && MUTED)} />
      <td className={cn(TD, "num", MUTED)}>{r.lastCollectAt ? `${age(r.lastCollectAt, now)} ago` : "–"}</td>
      <td className={TD}>
        <a
          href={explorer("account", r.w, net)}
          target="_blank"
          rel="noopener"
          className="num inline-flex min-h-6 items-center gap-1 text-muted-foreground"
        >
          {short(r.w)}
          <ArrowUpRight className="size-[11px]" strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only">{" (opens Solscan)"}</span>
        </a>
      </td>
    </tr>
  );
}

type RowProps = {
  i: WItem;
  now: number;
  windowMs: number;
  net: Net;
  current: boolean;
  onSelect(mint: string): void;
};

type TableProps = Omit<RowProps, "i" | "current"> & {
  list: WItem[];
  caption: string;
  selected: string | null;
};

function Table({ list, caption, selected, ...row }: TableProps) {
  return (
    // A named section is a region; tabIndex lets a keyboard user scroll the wide table sideways.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
    <section aria-label="Fee wallets table, scrolls sideways" tabIndex={0} className={REGION}>
      <table className="w-full min-w-[960px] text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className={MUTED}>
          <tr>
            {HEADS.map((h, n) => (
              <th
                key={h}
                scope="col"
                className={cn(TH, RIGHT.has(h) && "text-right", n === 0 && cn(STICKY, "pl-2"))}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <Row key={i.row.mint} i={i} current={i.row.mint === selected} {...row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function emptyCopy(failed: boolean, all: number, filter: Filter): string {
  if (failed) return "Could not load the W table. Refresh to try again.";
  if (all === 0) return "No coins yet. W wallets appear here once a coin launches.";
  return `No coins are ${filter.toLowerCase()} right now.`;
}

// Filtering and Show all are client-side: the data is already loaded (D-24).
function useRows(overview: AdminOverview, windowMs: number) {
  const [filter, setFilter] = useState<Filter>("All");
  const [all, setAll] = useState(false);
  // The load's own time renders on the server and the first client pass alike; the viewer's clock after mount.
  const [now, setNow] = useState(overview.loadedAt);
  useEffect(() => setNow(Date.now()), [overview.loadedAt]);
  const items = useMemo(
    () => wItems(overview.rows, overview.worker?.coins ?? [], now, windowMs),
    [overview, now, windowMs],
  );
  const counts = chipCounts(items);
  const chips = (["All", ...CHIPS] as Filter[]).map((c) => ({ label: `${c} ${counts[c]}`, value: c }));
  const shown = filter === "All" ? items : items.filter((i) => i.state.chip === filter);
  const list = all ? shown : shown.slice(0, FIRST);
  return { filter, setFilter, chips, items, shown, list, more: !all && shown.length > FIRST, setAll, now };
}

export function WTable({ overview, busy, windowMs, selected, onSelect }: Props) {
  const t = useRows(overview, windowMs);
  const failed = overview.loadedAt === 0;
  return (
    <Panel
      id="wtable-h"
      title="Fee wallets (W)"
      note="one per coin, derived from the master seed"
      busy={busy}
    >
      {failed && <p className="mb-4 text-[13px] text-destructive">{emptyCopy(true, 0, t.filter)}</p>}
      <div className="mb-4">
        <Chips
          legend="Filter coins by state"
          items={t.chips}
          pressed={t.filter}
          onPick={(v) => t.setFilter(v as Filter)}
          wrap
        />
      </div>
      {t.shown.length > 0 ? (
        <Table
          list={t.list}
          caption={`Fee wallets, ${t.filter}, ${t.shown.length} coins`}
          {...{ selected, onSelect, now: t.now, windowMs, net: overview.net }}
        />
      ) : (
        !failed && (
          <p className="text-xs text-muted-foreground">{emptyCopy(false, t.items.length, t.filter)}</p>
        )
      )}
      {t.more && (
        <Button className="mt-4 w-full text-xs md:min-h-9" onClick={() => t.setAll(true)}>
          {`Show all ${t.shown.length} coins`}
        </Button>
      )}
    </Panel>
  );
}
