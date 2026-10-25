"use client";
// The simulation dialog's footer and its after-send outcome (UI-SPEC phase table), split from admin-sim.tsx to
// keep both files short. The send button renders only for a ready simulation with an intent; a refused
// destination never gets one (T-06-18-02).
import type { Net } from "@bondr/core/api";
import type { AdminIntentView } from "@bondr/core/api-admin";
import { Check } from "lucide-react";
import type { RefObject } from "react";
import { sentFailedCopy } from "@/lib/admin-copy-sim";
import { short } from "@/lib/format";
import type { SimState } from "@/lib/use-sim";
import { Callout } from "./callout";
import { TxLink } from "./tx-link";
import { Button } from "./ui-button";
import { useWallet } from "./wallet";

const UNKNOWN =
  "Sent, not confirmed yet. Nothing is resent automatically. Refresh in a minute to see the result in the audit log.";

function Links({ view, net }: { view: AdminIntentView; net: Net }) {
  if (!view.sigs.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-3">
      {view.sigs.map((sig) => (
        <TxLink key={sig} signature={sig} net={net}>
          {short(sig)}
        </TxLink>
      ))}
    </span>
  );
}

/** Landed, sent but unconfirmed, or failed after send, each with one TxLink per signature (T-06-18-03). */
export function SimOutcome({ s, net }: { s: SimState; net: Net }) {
  const v = s.view;
  if (s.phase !== "done" || !v) return null;
  if (v.state === "landed")
    return (
      <div role="status" className="grid grid-cols-[16px_1fr] gap-2 text-sm">
        <Check className="mt-0.5 size-4 text-leaf" strokeWidth={1.5} aria-hidden="true" />
        <div>
          Sent. {v.landed} of {v.total} transactions landed.
          <Links view={v} net={net} />
        </div>
      </div>
    );
  const unknown = v.state === "unknown";
  return (
    <Callout variant={unknown ? "warn" : "error"}>
      {unknown ? UNKNOWN : sentFailedCopy(v.code, v.landed, v.total)}
      <Links view={v} net={net} />
    </Callout>
  );
}

type FootProps = {
  s: SimState;
  cancel: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onSend(): void;
  onAgain(): void;
};

// Below 768px the buttons stack full width with the primary on top; from 768px one right-aligned row.
export function SimFoot({ s, cancel, onClose, onSend, onAgain }: FootProps) {
  const locked = s.phase === "signing" || s.phase === "sending";
  const done = s.phase === "done";
  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
      {!done && (
        <Button ref={cancel} type="button" aria-disabled={locked || undefined} onClick={onClose}>
          Cancel
        </Button>
      )}
      {done && (
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      )}
      {s.phase === "again" && (
        <Button type="button" onClick={onAgain}>
          Simulate again
        </Button>
      )}
      {(s.phase === "ready" || locked) && <Send s={s} onSend={onSend} />}
    </div>
  );
}

// The admin wallet must be connected in Phantom before it can sign; the console's sign-in is a cookie only.
function Send({ s, onSend }: { s: SimState; onSend(): void }) {
  const wallet = useWallet();
  const busy = s.phase === "sending";
  if (s.phase === "ready" && !wallet.address)
    return (
      <Button type="button" variant="primary" onClick={() => void wallet.connect()}>
        Connect Phantom
      </Button>
    );
  return (
    <Button
      type="button"
      variant="primary"
      disabled={s.phase !== "ready"}
      aria-busy={busy || undefined}
      onClick={onSend}
    >
      {s.phase === "signing" ? "Waiting for Phantom…" : busy ? "Sending…" : "Sign with owner wallet and send"}
    </Button>
  );
}
