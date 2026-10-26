"use client";
// UI-SPEC Simulation dialog (ADMIN-01, ADMIN-04, D-12, D-14): a native dialog opened with showModal() (the page
// goes inert, so focus is trapped natively), focus on Cancel, never on send. It shows the simulation's result,
// the net balance table, the destination check and the permanent-action callout before anything can be
// signed; the run itself lives in use-sim.ts. Closing returns focus to the opener.
import type { AdminBalanceRow, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACTION_COPY, fill } from "@/lib/admin-copy-actions";
import { estimatedNote, refusedCopy, simResultLine } from "@/lib/admin-copy-sim";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { type SimState, useSim } from "@/lib/use-sim";
import { useAdmin } from "./admin-console";
import { SimFoot, SimOutcome } from "./admin-sim-foot";
import { Callout } from "./callout";

// The consent dialog's shell (Phase 2) without the leaf top glow: a bottom sheet below 768px, a 640px card from
// 768px. Close is instant.
const DIALOG =
  "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[calc(100dvh-24px)] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[24px] border-t border-line-strong text-foreground animate-sheet " +
  "bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] shadow-elev-2 backdrop:bg-ink/55 backdrop:backdrop-blur-[6px] " +
  "md:top-[80px] md:bottom-auto md:mx-auto md:max-h-[calc(100dvh-112px)] md:w-[min(640px,calc(100%-32px))] md:rounded-lg md:border md:animate-[rise_620ms_var(--ease-spring)_both]";

type Props = {
  action: AdminTxAction;
  mint: string | null;
  overview: AdminOverview;
  onClose(sent: boolean): void;
  onSending(on: boolean): void;
};

// showModal on mount with focus on Cancel; focus goes back to the opener when the dialog unmounts.
function useOpen() {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // Read before showModal moves focus: the button that opened the dialog.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    cancel.current?.focus();
    return () => opener?.focus();
  }, [opener]);
  return { dialog, cancel };
}

export function SimDialog({ action, mint, overview, onClose, onSending }: Props) {
  const { onUnauthorized } = useAdmin();
  const symbol = mint ? (overview.rows.find((r) => r.mint === mint)?.symbol ?? short(mint)) : "BONDR";
  const label = ACTION_COPY[action].label;
  const run = useSim(action, mint, symbol, onUnauthorized, onSending);
  const { dialog, cancel } = useOpen();
  // Escape, the backdrop and Cancel do nothing while Phantom is open or the send is in flight.
  const locked = run.s.phase === "signing" || run.s.phase === "sending";
  const close = () => {
    if (!locked) onClose(run.sent.current);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop; Escape (onCancel) is its keyboard twin
    <dialog
      ref={dialog}
      aria-labelledby="sim-h"
      className={DIALOG}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => (locked ? dialog.current?.showModal() : close())}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="grid gap-4 px-4 py-6 md:p-6">
        <Head
          title={mint ? `${label}, ${symbol}` : label}
          sent={run.s.phase === "sending" || run.s.phase === "done"}
        />
        <SimBody s={run.s} action={action} symbol={symbol} />
        <SimOutcome s={run.s} net={overview.net} />
        <SimFoot s={run.s} cancel={cancel} onClose={close} onSend={run.send} onAgain={run.simulate} />
      </div>
    </dialog>
  );
}

// The eyebrow must stop saying "nothing sent yet" once the owner has signed and the worker is sending.
function Head({ title, sent }: { title: string; sent: boolean }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {sent ? "Simulated, then sent" : "Simulated, nothing sent yet"}
      </p>
      <h2 id="sim-h" className="display text-[28px] leading-none">
        {title}
      </h2>
    </div>
  );
}

function SimBody({ s, action, symbol }: { s: SimState; action: AdminTxAction; symbol: string }) {
  const permanent = ACTION_COPY[action].permanent;
  const note = s.sim && estimatedNote(s.sim);
  return (
    <>
      {s.phase === "simulating" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
          Simulating…
        </p>
      )}
      {s.sim && <ResultLine sim={s.sim} />}
      {s.sim && s.sim.balances.length > 0 && <Balances rows={s.sim.balances} />}
      {s.sim && <Destinations dest={s.sim.destinations} symbol={symbol} />}
      {s.note && <Callout variant={s.note.variant}>{s.note.text}</Callout>}
      {s.sim && permanent && <Callout variant="warn">{fill(permanent, symbol)}</Callout>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {s.sim?.intent && <Message text={s.sim.intent.message} />}
    </>
  );
}

// The exact bytes Phantom will show (WR-B-05), so the owner can check the popup against this dialog.
function Message({ text }: { text: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Phantom shows exactly this message, not a transaction. Check that the action, mint and destination
        addresses match before you sign. The worker checks it again before sending.
      </p>
      <pre className="num rounded-md border border-line p-3 text-xs break-all whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

function ResultLine({ sim }: { sim: AdminSimResult }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {simResultLine(sim).map((p) => (
        <span key={p.pre + (p.post ?? "")}>
          {p.pre}
          <span
            className={cn(
              "num text-foreground",
              p.tone === "ok" && "text-leaf",
              p.tone === "danger" && "text-destructive",
            )}
          >
            {p.value}
          </span>
          {p.post}
        </span>
      ))}
    </p>
  );
}

const withUnit = (v: string, unit: AdminBalanceRow["unit"]) => (unit === "bps" ? v : `${v} ${unit}`);
const CELL = "px-2 py-2 text-right num";

// Net changes across every transaction (OQ1). Signs carry direction: inflows foreground, outflows muted.
function Balances({ rows }: { rows: AdminBalanceRow[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-line text-left font-semibold tracking-[0.09em] uppercase">
          <th className="px-2 py-2 font-semibold">Account</th>
          <th className="hidden px-2 py-2 text-right font-semibold md:table-cell">Before</th>
          <th className="px-2 py-2 text-right font-semibold">After</th>
          <th className="px-2 py-2 text-right font-semibold">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name + r.unit} className="border-b border-line">
            <th scope="row" className="px-2 py-2 text-left font-normal">
              {r.name}
            </th>
            <td className={cn(CELL, "hidden md:table-cell")}>{withUnit(r.before, r.unit)}</td>
            <td className={CELL}>{withUnit(r.after, r.unit)}</td>
            <td className={cn(CELL, r.change.startsWith("−") ? "text-muted-foreground" : "text-foreground")}>
              {withUnit(r.change, r.unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Destinations({ dest, symbol }: { dest: AdminSimResult["destinations"]; symbol: string }) {
  if (!dest.ok)
    return (
      <Callout variant="error">
        <span className="break-all">{refusedCopy(dest.refused, symbol)}</span>
      </Callout>
    );
  return (
    <p className="grid grid-cols-[16px_1fr] gap-2 text-xs">
      <Check className="mt-px size-4 text-leaf" strokeWidth={1.5} aria-hidden="true" />
      <span>
        <span className="text-leaf">Destinations check passed:</span> {dest.passed.join(", ")}. No other
        destination is allowed.
      </span>
    </p>
  );
}
