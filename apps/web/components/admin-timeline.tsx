"use client";
// UI-SPEC Timeline and recovery actions (ADMIN-03, ADMIN-08, D-13, D-21, D-31): the selected coin's steps, its
// live W balance and its action grid. One coin request per selection and one after each load (an action
// reloads the overview); never a timer. Hold, release and re-check run at once with no dialog (D-13).
import type { Net } from "@bondr/core/api";
import type { AdminActAction, AdminCoinLive, AdminCoinMemory, AdminTxAction } from "@bondr/core/api-admin";
import { ArrowUpRight, Check, Pause, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { actionStates, isHeld } from "@/lib/admin-applies";
import { actResultCopy, DEFAULT_HINT } from "@/lib/admin-copy-actions";
import type { AdminOverview, WRow } from "@/lib/admin-data";
import { wState } from "@/lib/admin-state";
import { type CoinTimeline, type Step, timelineSteps } from "@/lib/admin-timeline";
import { cn } from "@/lib/cn";
import { compact, explorer, feeSol, short, whole } from "@/lib/format";
import { ActionGrid } from "./admin-action-grid";
import { useAdmin } from "./admin-console";
import { Panel } from "./admin-panel";
import { HeldBox, StuckBox } from "./admin-timeline-boxes";
import { TxLink } from "./tx-link";

type CoinData = { timeline: CoinTimeline; live: AdminCoinLive | null };
// D-13: hold needs a reason (the DB CHECK); the console's one-click hold records this one.
const HOLD_REASON = "Held for review from the console";
const post = (op: string, body: unknown) =>
  fetch(`/api/admin/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);

/** The coin op once per mint and overview load; a 401 ends the session. */
function useCoin(mint: string, loadedAt: number, onUnauthorized: () => void) {
  const [data, setData] = useState<CoinData | null>(null);
  const [failed, setFailed] = useState(false);
  // loadedAt is a dependency on purpose: each overview load (Refresh, or after an action) refetches the coin.
  useEffect(() => {
    let live = true;
    void post("coin", { mint }).then(async (r) => {
      const body = r?.ok ? ((await r.json().catch(() => null)) as CoinData | null) : null;
      if (!live) return;
      if (r?.status === 401) return onUnauthorized();
      setFailed(!body);
      if (body) setData(body);
    });
    return () => {
      live = false;
    };
  }, [mint, loadedAt, onUnauthorized]);
  return { data, failed };
}

const ICON = {
  done: { box: "border-forest bg-forest text-foreground", icon: Check, word: "Done:" },
  stuck: { box: "border-destructive bg-destructive text-ink", icon: X, word: "Stuck:" },
  held: { box: "border-warn bg-warn-wash text-warn", icon: Pause, word: "Held:" },
  next: { box: "border-dashed border-line-strong bg-background", icon: null, word: "Next:" },
} as const;

function StepItem({ step, net, children }: { step: Step; net: Net; children?: ReactNode }) {
  const look = ICON[step.state];
  const Icon = look.icon;
  return (
    <li className="relative grid grid-cols-[24px_1fr_auto] gap-x-2 gap-y-1 pb-4 before:absolute before:top-[22px] before:bottom-0 before:left-[11px] before:w-px before:bg-line-strong last:before:hidden">
      <span className={cn("z-[1] grid size-[22px] place-items-center rounded-full border", look.box)}>
        {Icon && <Icon className="size-3" strokeWidth={2} aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          <span className="sr-only">{look.word} </span>
          {step.title}
        </p>
        {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
      </div>
      <span>
        {step.sig && (
          <TxLink signature={step.sig} net={net}>
            {short(step.sig)}
          </TxLink>
        )}
      </span>
      {children}
    </li>
  );
}

function LiveLine({ row, live }: { row: WRow; live: AdminCoinLive | null }) {
  return (
    <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {live && (
        <span className="num">
          W holds {feeSol(live.sol)} SOL, {whole(live.bondr)} BONDR, {compact(live.tokens)} {row.symbol}
        </span>
      )}
      <Link href={`/coin/${row.mint}`} className="inline-flex min-h-6 items-center text-mint">
        Token page
      </Link>
    </p>
  );
}

const reasonOf = (row: WRow, mem: AdminCoinMemory | undefined, t: CoinTimeline) =>
  row.heldReason ??
  mem?.hold ??
  (t.rows.findLast((r) => r.kind === "held")?.detail?.reason as string | undefined) ??
  "finalize deployer check";

/** The non-transaction POST: "Working…" on its button, the outcome in the hint, then one overview reload. */
function useAct(row: WRow, onChanged: () => Promise<void>, onUnauthorized: () => void) {
  const [hint, setHint] = useState(DEFAULT_HINT);
  const [busy, setBusy] = useState<AdminActAction | null>(null);
  const act = useCallback(
    async (action: AdminActAction) => {
      setBusy(action);
      const r = await post("act", {
        action,
        mint: row.mint,
        ...(action === "hold" && { reason: HOLD_REASON }),
      });
      if (r?.status === 401) return onUnauthorized();
      const body = (await r?.json().catch(() => null)) as { outcome?: string; error?: string } | null;
      setBusy(null);
      setHint(actResultCopy((r?.ok ? body?.outcome : body?.error) ?? "", row.symbol));
      await onChanged(); // the new loadedAt refetches this coin
    },
    [row.mint, row.symbol, onChanged, onUnauthorized],
  );
  return { hint, setHint, busy, act };
}

type BodyProps = { row: WRow; overview: AdminOverview; windowMs: number; onChanged(): Promise<void> } & {
  onTx?(action: AdminTxAction): void;
};

function CoinBody({ row, overview, windowMs, onChanged, onTx }: BodyProps) {
  const { onUnauthorized } = useAdmin();
  const { data, failed } = useCoin(row.mint, overview.loadedAt, onUnauthorized);
  const a = useAct(row, onChanged, onUnauthorized);
  if (!data)
    return (
      <p className="text-xs text-muted-foreground">
        {failed ? "Could not load this coin's timeline. Refresh to try again." : "Loading timeline…"}
      </p>
    );
  const now = Date.now();
  const mem = data.live?.memory ?? overview.worker?.coins.find((c) => c.mint === row.mint);
  const state = wState(row, mem, now, windowMs);
  const balances = overview.worker?.balances ?? null;
  const states = actionStates({ row, state, live: data.live, timeline: data.timeline, balances });
  const held = isHeld(row, state);
  const shared = { symbol: row.symbol, states, busy: a.busy, onAct: a.act, onTx, onHint: a.setHint };
  return (
    <>
      <LiveLine row={row} live={data.live} />
      <ol aria-label={`${row.symbol} timeline`}>
        {timelineSteps(data.timeline, row, mem, data.live, now, windowMs).map((s) => (
          <StepItem key={s.key} step={s} net={overview.net}>
            {s.state === "stuck" && mem?.stuck && (
              <StuckBox
                {...shared}
                stuck={mem.stuck}
                deployer={data.timeline.launch?.wallet ?? null}
                {...{ held, now }}
              />
            )}
            {s.state === "held" && (
              <HeldBox
                {...shared}
                reason={reasonOf(row, mem, data.timeline)}
                finalizeHeld={row.finalize === "held"}
              />
            )}
          </StepItem>
        ))}
      </ol>
      <ActionGrid {...shared} held={held} hint={a.hint} />
    </>
  );
}

type Props = {
  overview: AdminOverview;
  selected: string | null;
  windowMs: number;
  onChanged(): Promise<void>;
  onTx?(action: AdminTxAction): void; // 06-18: opens the simulation dialog; tx buttons render only with it
};

export function AdminTimeline({ overview, selected, windowMs, onChanged, onTx }: Props) {
  const row = overview.rows.find((r) => r.mint === selected);
  const note = row && (
    <>
      {row.name}, W{" "}
      <a
        href={explorer("account", row.w, overview.net)}
        target="_blank"
        rel="noopener"
        className="num inline-flex items-center gap-1"
      >
        {short(row.w)}
        <ArrowUpRight className="size-[11px]" strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">{" (opens Solscan)"}</span>
      </a>
    </>
  );
  return (
    <Panel
      id="timeline-h"
      title={row ? `Timeline, ${row.symbol}` : "Timeline"}
      note={note}
      focusTitle
      className="relative"
    >
      {row ? (
        <CoinBody key={row.mint} {...{ row, overview, windowMs, onChanged, onTx }} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick a coin in the table to see its timeline and recovery actions.
        </p>
      )}
    </Panel>
  );
}
