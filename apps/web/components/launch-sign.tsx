"use client";
// Step 4: the five rows, the failure table and the restore after a reload. The network sequence is
// lib/launch-run.ts.
import { Check, X } from "lucide-react";
import { type Dispatch, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { FAULTS, NOT_FOUND } from "@/lib/launch-faults";
import { type Code, launch, type Progress, poll, type Run, Stop } from "@/lib/launch-run";
import { tickerFault } from "@/lib/ticker-copy";
import { Callout } from "./callout";
import type { Live, StepProps } from "./launch-flow";
import { TxLink } from "./tx-link";
import { Button } from "./ui-button";
import { useWallet } from "./wallet";

const KEY = "bondr:launch";

/** The posted launch's id, so a reload restores it. Blocked storage only loses the restore. */
export const stored = {
  get(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(id: string | null): void {
    try {
      id ? sessionStorage.setItem(KEY, id) : sessionStorage.removeItem(KEY);
    } catch {}
  },
};

function leave(run: Run, code: Code): boolean {
  if (code === "insufficient_balance") run.dispatch({ type: "go", step: 2, focus: "buy" });
  else if (code === "consent_required") {
    run.wallet.forgetConsent();
    run.dispatch({ type: "go", step: 3 });
  } else if (code === "not_found") run.dispatch({ type: "reset", notice: NOT_FOUND });
  else return false;
  return true;
}

function fail(run: Run, e: unknown) {
  if (run.signal.aborted) return;
  // hasOwn, not `in`: a passed-through "toString" must not match a prototype key (web IN-01).
  const code = e instanceof Stop && Object.hasOwn(FAULTS, e.code) ? e.code : "build_failed";
  stored.set(null); // every fault means nothing is in flight: refused, never sent, or settled as failed
  if (leave(run, code)) return;
  if (code === "paused") run.live.refresh();
  const row = FAULTS[code].row;
  const refusal = e instanceof Stop ? e.refusal : undefined;
  // Step 1 names the lock on the symbol field until the creator changes the ticker (UI-SPEC A1).
  const symbol = run.state.fields.symbol.trim().toUpperCase();
  if (code === "ticker_locked") run.dispatch({ type: "refused", refused: { symbol, err: refusal ?? {} } });
  run.set({ failed: code, ...(row && { row }), ...(refusal && { refusal }) });
}

const FRESH: Progress = { row: 1, failed: null, sent: false };

function useRun(props: StepProps, attempt: number) {
  const wallet = useWallet();
  const restored = useRef(props.state.view);
  const [p, setP] = useState<Progress>(
    restored.current
      ? { row: 5, failed: null, sent: true, sig: restored.current.signature ?? undefined }
      : FRESH,
  );
  const latest = useRef({ ...props, wallet });
  latest.current = { ...props, wallet };
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    ctrl.current = abort;
    const { state, live, dispatch, wallet } = latest.current;
    const guard =
      <A,>(f: (a: A) => void) =>
      (a: A) =>
        abort.signal.aborted || f(a);
    const set = guard((q: Partial<Progress>) => setP((cur) => ({ ...cur, ...q })));
    const posted = (id: string) => stored.set(id);
    const run: Run = { state, live, wallet, dispatch: guard(dispatch), set, signal: abort.signal, posted };
    const id = restored.current?.id;
    (attempt === 0 && id ? poll(run, id) : launch(run)).catch((e) => fail(run, e));
    return () => abort.abort();
  }, [attempt]);
  return { p, setP, ctrl };
}

const ROWS: [string, (p: Progress, exit: string) => string][] = [
  ["Image and metadata pinned to IPFS", (p) => (p.cid ? `CID ${short(p.cid)}` : "")],
  [
    "Transaction built",
    (p, exit) => (p.bytes ? `${p.bytes.toLocaleString("en")} of 1,232 bytes, create + buy + ${exit}` : ""),
  ],
  ["Waiting for your signature in Phantom", () => "Check the Phantom window"],
  ["BONDR checks the message and adds the mint signature", () => "Only if your exit is inside"],
  ["Sent, confirming", () => "Usually under 2 seconds"],
];

type RowState = "wait" | "now" | "done" | "failed";
const rowState = (n: number, p: Progress): RowState =>
  n < p.row ? "done" : n > p.row ? "wait" : p.failed ? "failed" : "now";

const ICON: Record<RowState, string> = {
  wait: "border-line-strong",
  now: "border-leaf border-t-transparent animate-[spin_900ms_linear_infinite]",
  done: "border-forest bg-forest text-foreground",
  failed: "border-destructive bg-destructive text-ink",
};

function SignRow({ n, p, exit }: { n: number; p: Progress; exit: string }) {
  const s = rowState(n, p);
  const [title, sub] = ROWS[n - 1] as (typeof ROWS)[number];
  return (
    <li
      data-state={s}
      className={cn(
        "grid grid-cols-[28px_1fr_auto] items-start gap-2 border-b border-line py-4",
        s === "wait" && "text-muted-foreground",
      )}
    >
      <span className={cn("grid size-[22px] place-items-center rounded-full border", ICON[s])}>
        {s === "done" && <Check className="size-3" strokeWidth={2} aria-hidden="true" />}
        {s === "failed" && <X className="size-3" strokeWidth={2} aria-hidden="true" />}
      </span>
      <span>
        {title}
        <small className="block text-xs text-muted-foreground">{sub(p, exit)}</small>
      </span>
      <span className="num text-xs text-muted-foreground">{s === "done" ? "done" : ""}</span>
    </li>
  );
}

type OutcomeProps = { p: Progress; net: Live["status"]; symbol: string; onRetry(): void };

function Outcome({ p, net, symbol, onRetry }: OutcomeProps) {
  const link = p.sig && (
    <TxLink signature={p.sig} net={net?.net ?? "devnet"}>{`Launch tx ${short(p.sig)}`}</TxLink>
  );
  if (!p.failed)
    return p.unknown ? (
      <Callout title="Still confirming.">
        Do not launch again until this finishes; it can take up to a minute. {link}
      </Callout>
    ) : null;
  const code = p.failed;
  const fault = FAULTS[code];
  const text =
    code === "ticker_locked" || code === "ticker_reserved"
      ? tickerFault(code, symbol, p.refusal ?? {})
      : fault.text;
  return (
    <Callout variant="error">
      {text} {code === "onchain" && link}
      {fault.action && (
        <Button type="button" variant="solid" className="mt-3 flex" onClick={onRetry}>
          {fault.action}
        </Button>
      )}
    </Callout>
  );
}

function useAccountSwitch(
  ctrl: { current: AbortController | null },
  setP: Dispatch<(p: Progress) => Progress>,
) {
  const { onAccountChange } = useWallet();
  useEffect(
    () =>
      onAccountChange(() =>
        setP((cur) => {
          if (cur.sent || cur.failed) return cur; // after the post the launch is already the dev's
          ctrl.current?.abort();
          return { ...cur, failed: "switched" };
        }),
      ),
    [onAccountChange, ctrl, setP],
  );
}

export function LaunchSign(props: StepProps) {
  const { state, dispatch, live } = props;
  const [attempt, setAttempt] = useState(0);
  const { p, setP, ctrl } = useRun(props, attempt);
  useAccountSwitch(ctrl, setP);
  const retry = () => {
    // A restored launch has no form left to pin from: start over at step 1.
    if (!state.image && !state.pin) return dispatch({ type: "reset" });
    setP(FRESH);
    setAttempt((a) => a + 1);
  };
  const done = p.row > 1 && !p.failed ? `Step ${p.row - 1} of 5 done: ${ROWS[p.row - 2]?.[0]}` : "";
  const exit = state.exit ?? state.view?.exit ?? "burn";
  return (
    <div className="grid gap-6">
      <ol aria-label="Launch progress" className="grid">
        {[1, 2, 3, 4, 5].map((n) => (
          <SignRow key={n} n={n} p={p} exit={exit} />
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {done}
      </p>
      <Outcome p={p} net={live.status} symbol={state.fields.symbol.trim().toUpperCase()} onRetry={retry} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-muted-foreground">
          Keep this tab open until your coin is live.
          {live.status?.net === "devnet" &&
            " On devnet, turn on Testnet Mode in Phantom settings so it shows devnet balances."}
        </p>
        {(!p.sent || (p.failed && p.row <= 4)) && (
          <Button type="button" onClick={() => dispatch({ type: "go", step: 3 })}>
            Back to review
          </Button>
        )}
      </div>
    </div>
  );
}
