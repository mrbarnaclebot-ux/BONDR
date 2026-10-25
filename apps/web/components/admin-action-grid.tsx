"use client";
// UI-SPEC Recovery actions (ADMIN-03, D-16): the coin's action buttons in the mockup order and the polite hint
// line. A button that does not apply stays focusable (aria-disabled, the data-off look) and writes its reason to
// the hint instead of acting. Transaction buttons render only when onTx is passed (06-18 adds the dialog).
import type { AdminActAction, AdminTxAction } from "@bondr/core/api-admin";
import type { ActionState, GridKey } from "@/lib/admin-applies";
import { ACTION_COPY } from "@/lib/admin-copy-actions";
import { Button } from "./ui-button";

// "Burn buyback now" sits on the Wallets panel; hold and release share one slot.
const ORDER: (GridKey | "toggle")[] = [
  ...["sweep_now", "retry_forced_bond", "burn_w_tokens", "run_migrate", "finalize_split", "toggle"],
  ...["retry_sweep", "distribute_now", "recheck_launch", "sweep_leftovers"],
] as (GridKey | "toggle")[];
const ACT = new Set<string>(["hold", "release_hold", "recheck_launch"]);
export const isAct = (k: string): k is AdminActAction => ACT.has(k);

type ButtonProps = {
  label: string;
  state: ActionState;
  busy: boolean;
  primary?: boolean;
  onRun(): void;
  onReason(reason: string): void;
};

/** One recovery button: runs when it applies, else announces why not. Shared with the stuck and held boxes. */
export function ActionButton({ label, state, busy, primary, onRun, onReason }: ButtonProps) {
  const off = !state.applies;
  return (
    <Button
      variant={primary ? "primary" : "quiet"}
      className="min-h-11 px-3 text-xs md:min-h-9"
      aria-disabled={off || busy || undefined}
      aria-busy={busy || undefined}
      data-off={off ? "" : undefined}
      onClick={() => {
        if (busy) return;
        if (off) onReason(state.reason);
        else onRun();
      }}
    >
      {busy ? "Working…" : label}
    </Button>
  );
}

type GridProps = {
  symbol: string;
  states: Record<GridKey, ActionState>;
  held: boolean;
  busy: AdminActAction | null;
  hint: string;
  onAct(action: AdminActAction): void;
  onTx?(action: AdminTxAction): void;
  onHint(text: string): void;
};

export function ActionGrid({ symbol, states, held, busy, hint, onAct, onTx, onHint }: GridProps) {
  const keys = ORDER.map((k) => (k === "toggle" ? (held ? "release_hold" : "hold") : k)).filter(
    (k) => isAct(k) || onTx,
  );
  return (
    <>
      <h3 className="mt-4 text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        Recovery actions for {symbol}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {keys.map((k) => (
          <ActionButton
            key={k}
            label={ACTION_COPY[k].label}
            state={states[k]}
            busy={busy === k}
            onRun={() => (isAct(k) ? onAct(k) : onTx?.(k))}
            onReason={onHint}
          />
        ))}
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {hint}
      </p>
    </>
  );
}
