"use client";
// Step 4: the five rows, the failure table and the restore after a reload. The network sequence is
// lib/launch-run.ts.
import { Check, X } from "lucide-react";
import { type Dispatch, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { type Code, launch, type Progress, poll, type Row, type Run, Stop } from "@/lib/launch-run";
import { Callout } from "./callout";
import type { Live, StepProps } from "./launch-flow";
import { TxLink } from "./tx-link";
import { Button } from "./ui-button";
import { useWallet } from "./wallet";

const KEY = "bondr:launch";
export const NOT_FOUND = "We could not find that launch. Start again.";

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

type Fault = { row?: Row; text: string; action: "Try again" | "Build again" | null };

const BUILD_FAILED: Fault = {
  text: "Could not build your launch transaction. Nothing was sent. Try again.",
  action: "Try again",
};
// UI-SPEC step 4 failure table. A fault marks the row that was running unless it names one. The first three
// leave step 4 instead (see leave()); a code missing here falls back to Build failed, so none is silent.
const FAULTS: Record<Code, Fault> = {
  insufficient_balance: { text: "", action: null },
  consent_required: { text: "", action: null },
  not_found: { text: NOT_FOUND, action: null },
  pin_failed: {
    text: "Could not pin your image and metadata to IPFS. Nothing was sent. Try again.",
    action: "Try again",
  },
  pool_empty: {
    text: "No bndr addresses are ready right now. Nothing was sent. Try again in a few minutes.",
    action: "Try again",
  },
  rate_limited: {
    text: "Too many launch attempts from this wallet. Nothing was sent. Wait a minute, then try again.",
    action: null,
  },
  build_failed: BUILD_FAILED,
  worker_unavailable: BUILD_FAILED,
  invalid_input: BUILD_FAILED,
  rejected: {
    text: "Phantom rejected the request. Nothing was sent and no SOL left your wallet. Your mint address stays reserved for 10 minutes.",
    action: "Try again",
  },
  expired: {
    row: 3,
    text: "This transaction expired before it was signed. Nothing was sent. Build a fresh one.",
    action: "Build again",
  },
  switched: {
    text: "Phantom switched accounts. Nothing was sent. Start signing again with the account you want to launch from.",
    action: "Try again",
  },
  cosign_refused: {
    text: "BONDR did not co-sign. The signed transaction did not match the one BONDR built, so nothing was sent. Try again; if it repeats, disconnect and reconnect Phantom.",
    action: "Try again",
  },
  paused: {
    text: "Launches were paused before your launch was sent. Nothing was sent. Your details are kept; launch when the pause lifts.",
    action: null,
  },
  onchain: {
    text: "Your launch failed on-chain. Only the network fee left your wallet. Try again.",
    action: "Try again",
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
  run.set({ failed: code, ...(row && { row }) });
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

function Outcome({ p, net, onRetry }: { p: Progress; net: Live["status"]; onRetry(): void }) {
  const link = p.sig && (
    <TxLink signature={p.sig} net={net?.net ?? "devnet"}>{`Launch tx ${short(p.sig)}`}</TxLink>
  );
  if (!p.failed)
    return p.unknown ? (
      <Callout title="Still confirming.">
        Do not launch again until this finishes; it can take up to a minute. {link}
      </Callout>
    ) : null;
  const fault = FAULTS[p.failed];
  return (
    <Callout variant="error">
      {fault.text} {p.failed === "onchain" && link}
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
      <Outcome p={p} net={live.status} onRetry={retry} />
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
