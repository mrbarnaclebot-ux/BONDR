"use client";
// UI-SPEC Wallets (ADMIN-02, D-07, D-23): treasury, buyback and ops, read from chain by the worker with the page
// load and on Refresh only, values led by SOL, then the platform totals from Postgres.
import type { ReactNode } from "react";
import { buybackCopy, type Cell, opsCopy, totalsCopy, treasuryCopy } from "@/lib/admin-copy-health";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { Panel, TONE } from "./admin-panel";

function Row({ name, cell, children }: { name: string; cell: Cell; children?: ReactNode }) {
  const warn = cell.tone === "warn";
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-b border-line py-2",
        // UI-SPEC Shape: the ops warn row is a warn-wash band inset 8px each side.
        warn && "-mx-2 rounded-sm border-transparent bg-warn-wash px-2",
      )}
    >
      <dt className="text-[13px] font-semibold">{name}</dt>
      <dd className={cn("num text-[15px]", TONE[cell.tone])}>{cell.value}</dd>
      <dd className="col-span-2 text-xs text-muted-foreground" suppressHydrationWarning>
        {cell.sub}
      </dd>
      {children}
    </div>
  );
}

export function AdminWallets({ overview, busy }: { overview: AdminOverview; busy: boolean }) {
  const b = overview.worker?.balances;
  const now = Date.now();
  return (
    <Panel id="wallets-h" title="Wallets" busy={busy}>
      {b ? (
        <dl>
          <Row name="Treasury" cell={treasuryCopy(b)} />
          {/* 06-18 mounts "Burn buyback now" as this row's child. */}
          <Row name="Buyback" cell={buybackCopy(b, now)} />
          <Row name="Ops, fee payer" cell={opsCopy(b)} />
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">Could not read balances. Refresh to try again.</p>
      )}
      {overview.loadedAt > 0 && (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {totalsCopy(overview.totals).map((t) => {
            const [n, ...words] = t.split(" ");
            return (
              <span key={t}>
                <span className="num text-foreground">{n}</span> {words.join(" ")}
              </span>
            );
          })}
        </p>
      )}
    </Panel>
  );
}
