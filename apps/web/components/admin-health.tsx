"use client";
// UI-SPEC Health (ADMIN-06, D-25 to D-28): six cells from the worker-memory poll and two (vanity pool, reconcile)
// from the page load, which say so. Cells are not live regions: they change every 10 s and would be noise.
import type { ReactNode } from "react";
import {
  type Cell,
  clock,
  heartbeatCopy,
  lastRunsCopy,
  reconcileCopy,
  rpcCopy,
  sentryCopy,
  stuckCopy,
  vanityCopy,
} from "@/lib/admin-copy-health";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { utcStamp } from "@/lib/format";
import type { HealthPoll } from "@/lib/use-health";
import { Panel, TONE } from "./admin-panel";

const DASH: Cell = { value: "–", sub: "", tone: "muted" };

type CellProps = { label: string; cell: Cell; dot?: string; busy?: boolean; children?: ReactNode };

function HealthCell({ label, cell, dot, busy, children }: CellProps) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn("border-b border-line py-3 transition-opacity duration-(--dur)", busy && "opacity-60")}
    >
      <dt className="flex items-center gap-2 text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {dot && <span aria-hidden="true" className={cn("size-2 flex-none rounded-full", dot)} />}
        {label}
      </dt>
      <dd className={cn("num text-[13px]", TONE[cell.tone])}>{cell.value}</dd>
      {children ?? (cell.sub && <dd className="text-xs text-muted-foreground">{cell.sub}</dd>)}
    </div>
  );
}

// D-25: one replica, so the honest answer is this instance and its boot time, in foreground, not a warning.
const singleReplica = (instance: string, bootAt: number): Cell => ({
  value: "Single replica, no lock",
  sub: `Instance ${instance}, booted ${utcStamp(new Date(bootAt).toISOString())} UTC`,
  tone: "plain",
});

type StuckProps = { cell: Cell; mint: string | undefined; onSelect?(mint: string): void };

// The first stuck coin is a button that selects it once the W table and timeline exist (06-16).
function StuckLine({ cell, mint, onSelect }: StuckProps) {
  if (!cell.sub) return null;
  if (!mint || !onSelect) return <dd className="text-xs text-muted-foreground">{cell.sub}</dd>;
  return (
    <dd>
      <button
        type="button"
        className="min-h-11 cursor-pointer text-left text-xs text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground md:min-h-6"
        onClick={() => onSelect(mint)}
      >
        {cell.sub}
      </button>
    </dd>
  );
}

type Props = {
  poll: HealthPoll;
  overview: AdminOverview;
  busy: boolean;
  className?: string;
  onSelect?(mint: string): void;
};

export function AdminHealth({ poll, overview, busy, className, onSelect }: Props) {
  const { health, failedAt, lastOk } = poll;
  const now = Date.now();
  const symbolOf = (mint: string) => overview.rows.find((r) => r.mint === mint)?.symbol ?? null;
  const loaded = overview.loadedAt > 0;
  const stuck = health ? stuckCopy(health.stuck, symbolOf) : DASH;
  const dot =
    failedAt !== null ? "bg-destructive" : health ? "animate-live bg-leaf text-leaf" : "bg-muted-foreground";
  return (
    <Panel
      id="health-h"
      title="Health"
      note={lastOk === null ? undefined : `Updated ${clock(lastOk)}`}
      className={className}
    >
      <dl className="grid md:grid-cols-2 md:gap-x-6">
        <HealthCell label="Worker heartbeat" cell={heartbeatCopy(poll, now)} dot={dot} />
        <HealthCell
          label="Leader lock"
          cell={health ? singleReplica(health.instance, health.bootAt) : DASH}
        />
        <HealthCell label="RPC" cell={health ? rpcCopy(health.rpc) : DASH} />
        <HealthCell label="Last runs" cell={health ? lastRunsCopy(health.lastRuns, now) : DASH} />
        <HealthCell label="Stuck steps" cell={stuck}>
          <StuckLine cell={stuck} mint={health?.stuck.first?.mint} onSelect={onSelect} />
        </HealthCell>
        <HealthCell label="Sentry" cell={health ? sentryCopy(health.sentry) : DASH} />
        <HealthCell label="Vanity pool" busy={busy} cell={loaded ? vanityCopy(overview.vanityFree) : DASH} />
        <HealthCell
          label="Reconcile, nightly"
          busy={busy}
          cell={loaded ? reconcileCopy(overview.reconcile) : DASH}
        />
      </dl>
    </Panel>
  );
}
