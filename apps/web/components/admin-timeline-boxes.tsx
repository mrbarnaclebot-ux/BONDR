"use client";
// UI-SPEC Stuck box and Held box (D-05, D-15, D-20): the stuck step's last error as contract words, its attempt
// count and its retry inline; a held coin's reason with Release hold, and Finalize split first for a held
// finalize, because re-running finalize with the recorded deployer is the release.
import type { AdminActAction, AdminCoinMemory, AdminTxAction } from "@bondr/core/api-admin";
import type { ActionState, GridKey } from "@/lib/admin-applies";
import { ACTION_COPY, stuckErrorCopy } from "@/lib/admin-copy-actions";
import { nextStepCopy } from "@/lib/admin-state";
import { age, short } from "@/lib/format";
import { ActionButton, isAct } from "./admin-action-grid";

// The engine step's retry action (fee-stuck.ts stepOf names); other steps have no retry button.
const RETRY: Record<string, GridKey> = {
  finalize: "finalize_split",
  "forced bond": "retry_forced_bond",
  forcedBond: "retry_forced_bond",
  sweep: "retry_sweep",
  distribute: "distribute_now",
};

// Spans the step's text and link columns; the whole row below 768px.
const BOX = "col-span-3 mt-1.5 grid gap-2 rounded-md border px-4 py-2 text-xs md:col-span-2 md:col-start-2";

type Shared = {
  symbol: string;
  states: Record<GridKey, ActionState>;
  busy: AdminActAction | null;
  onAct(action: AdminActAction): void;
  onTx?(action: AdminTxAction): void;
  onHint(text: string): void;
};

type ButtonsProps = Shared & { keys: GridKey[]; primary: GridKey | null; label?: string };

// Transaction buttons render only with onTx, as in the grid. `label` renames the primary button.
function Buttons({ keys, primary, label, ...s }: ButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {keys
        .filter((k) => isAct(k) || s.onTx)
        .map((k) => (
          <ActionButton
            key={k}
            label={k === primary && label ? label : ACTION_COPY[k].label}
            state={s.states[k]}
            busy={s.busy === k}
            primary={k === primary}
            onRun={() => (isAct(k) ? s.onAct(k) : s.onTx?.(k))}
            onReason={s.onHint}
          />
        ))}
    </div>
  );
}

type StuckProps = Shared & {
  stuck: NonNullable<AdminCoinMemory["stuck"]>;
  deployer: string | null;
  held: boolean;
  now: number;
};

export function StuckBox({ stuck, deployer, held, now, ...s }: StuckProps) {
  const retry = RETRY[stuck.step] ?? null;
  const preflight =
    stuck.step === "finalize" && deployer
      ? ` Pre-flight: deployer ${short(deployer)} matches the launch signer.`
      : "";
  const when = age(new Date(stuck.at).toISOString(), now);
  return (
    <div className={`${BOX} border-destructive/40 bg-danger-wash`}>
      <p>
        Last error <span className="num">{when}</span> ago: {stuckErrorCopy(stuck.code)} after send,{" "}
        {stuck.attempts} of 3 attempts.{preflight}
      </p>
      {/* The retry reads as the W table's next step ("Retry finalize split"); the grid keeps "Finalize split". */}
      <Buttons
        {...s}
        keys={[...(retry ? [retry] : []), held ? ("release_hold" as const) : ("hold" as const)]}
        primary={retry}
        label={nextStepCopy("stuck", { step: stuck.step })}
      />
    </div>
  );
}

type HeldProps = Shared & { reason: string; finalizeHeld: boolean };

export function HeldBox({ reason, finalizeHeld, ...s }: HeldProps) {
  return (
    <div className={`${BOX} border-warn/40 bg-warn-wash`}>
      <p>
        Held: {reason}. The engine sends nothing for {s.symbol} until you release it.
      </p>
      <Buttons
        {...s}
        keys={[...(finalizeHeld ? (["finalize_split"] as const) : []), "release_hold"]}
        primary={finalizeHeld ? "finalize_split" : null}
      />
    </div>
  );
}
