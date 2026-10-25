"use client";
// UI-SPEC Wallets (ADMIN-02, D-07, D-23): treasury, buyback and ops, read from chain by the worker with the page
// load and on Refresh only, values led by SOL, then the platform totals from Postgres. "Burn buyback now" is a
// platform action with no coin (D-16), so it sits on the Buyback row and works with nothing selected.
import type { AdminBalances, AdminTxAction } from "@bondr/core/api-admin";
import { type ReactNode, useState } from "react";
import { ACTION_COPY } from "@/lib/admin-copy-actions";
import { buybackCopy, type Cell, opsCopy, totalsCopy, treasuryCopy } from "@/lib/admin-copy-health";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { ActionButton } from "./admin-action-grid";
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

// Greyed (aria-disabled, still focusable) with nothing to burn; activating it then announces why.
function BurnBuyback({ b, onTx }: { b: AdminBalances; onTx(action: AdminTxAction, mint: null): void }) {
  const [hint, setHint] = useState("");
  const { label, reason } = ACTION_COPY.burn_buyback;
  const applies = BigInt(b.buybackBondr) > 0n;
  return (
    <dd className="col-span-2 mt-1 grid justify-items-start gap-1">
      <ActionButton
        label={label}
        state={{ applies, reason: applies ? "" : reason }}
        busy={false}
        onRun={() => onTx("burn_buyback", null)}
        onReason={setHint}
      />
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {hint}
      </p>
    </dd>
  );
}

type Props = { overview: AdminOverview; busy: boolean; onTx(action: AdminTxAction, mint: null): void };

export function AdminWallets({ overview, busy, onTx }: Props) {
  const b = overview.worker?.balances;
  const now = Date.now();
  return (
    <Panel id="wallets-h" title="Wallets" busy={busy}>
      {b ? (
        <dl>
          <Row name="Treasury" cell={treasuryCopy(b)} />
          <Row name="Buyback" cell={buybackCopy(b, now)}>
            <BurnBuyback b={b} onTx={onTx} />
          </Row>
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
