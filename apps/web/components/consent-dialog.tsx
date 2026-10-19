"use client";
import { Check, CircleAlert } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "./ui-button";
import { useWallet } from "./wallet";
import { focusButton, short } from "./wallet-button";

const STORES = [
  "Your wallet address and the time you accepted these terms",
  "Coins you launch and trades you make through BONDR, which are public on Solana anyway",
  "Error reports when something breaks, without wallet data",
];

// Bottom sheet below 768px, centered card from 768px up (UI-SPEC Breakpoints).
const DIALOG =
  "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[calc(100dvh-24px)] w-full max-w-none overflow-y-auto rounded-t-[24px] border-t border-line-strong text-foreground animate-sheet " +
  "bg-[radial-gradient(90%_50%_at_50%_0%,color-mix(in_oklch,var(--leaf)_12%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] " +
  "shadow-[var(--elev-2),0_0_0_1px_color-mix(in_oklch,var(--leaf)_18%,transparent)] backdrop:bg-ink/55 backdrop:backdrop-blur-[6px] " +
  "md:top-[120px] md:bottom-auto md:mx-auto md:w-[min(540px,calc(100%-32px))] md:rounded-lg md:border md:animate-[rise_620ms_var(--ease-spring)_both]";

/** Opens on the first connect of an address with no stored consent; nothing is sent before Accept. */
export function ConsentDialog() {
  const { status, address, consented } = useWallet();
  if (status !== "connected" || !address || consented) return null;
  return <ConsentPrompt key={address} address={address} />;
}

function ConsentPrompt({ address }: { address: string }) {
  const { disconnect, markConsented } = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<"open" | "saving" | "failed">("open");
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    box.current?.focus();
    return () => void focusButton(); // Accepted or declined, focus goes back to the wallet control
  }, []);
  const saving = state === "saving";
  const decline = () => {
    if (!saving) void disconnect();
  };
  const accept = async () => {
    setState("saving");
    const ok = await fetch("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: address }),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) markConsented();
    else setState("failed");
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is the backdrop; Escape (onCancel) is its keyboard twin
    <dialog
      ref={dialog}
      aria-labelledby="consent-heading"
      aria-describedby="consent-intro"
      className={DIALOG}
      onCancel={(e) => {
        e.preventDefault();
        decline();
      }}
      onClick={(e) => e.target === e.currentTarget && decline()}
    >
      <div className="grid gap-4 px-4 py-6 md:p-8">
        <Intro address={address} />
        <Agree box={box} agreed={agreed} onChange={setAgreed} />
        {state === "failed" && <SaveFailed />}
        <div className="flex flex-wrap gap-3 [&>*]:flex-1">
          <Button type="button" size="lg" disabled={saving} onClick={decline}>
            Not now, disconnect
          </Button>
          <Button type="button" variant="primary" size="lg" disabled={!agreed || saving} onClick={accept}>
            {saving ? "Saving…" : "Accept and continue"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function Intro({ address }: { address: string }) {
  return (
    <>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-leaf" aria-hidden="true" />
        Phantom connected, <span className="num">{short(address)}</span>
      </p>
      <h2
        id="consent-heading"
        className="display text-[1.75rem] leading-none md:text-[2.75rem] md:leading-[0.95]"
      >
        Before BONDR remembers this wallet
      </h2>
      <p id="consent-intro" className="text-sm text-muted-foreground">
        Browsing needs nothing from you. If you accept, BONDR stores:
      </p>
      <ul className="grid gap-3 text-sm">
        {STORES.map((item) => (
          <li key={item} className="grid grid-cols-[20px_1fr] gap-2.5">
            <Check className="mt-[3px] size-4 text-mint" strokeWidth={1.5} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <p className="rounded-md border border-leaf/30 bg-leaf-wash px-4 py-3 text-sm">
        BONDR never sees your private key or seed phrase and cannot move your funds. Every transaction is
        signed by you in Phantom.
      </p>
    </>
  );
}

type AgreeProps = { box: RefObject<HTMLInputElement | null>; agreed: boolean; onChange(v: boolean): void };

// The terms open in a new tab so the dialog and its checkbox survive reading them.
function Agree({ box, agreed, onChange }: AgreeProps) {
  return (
    <label className="grid min-h-11 cursor-pointer grid-cols-[22px_1fr] items-start gap-2.5 py-1 text-sm">
      <input
        ref={box}
        type="checkbox"
        className="mt-0.5 size-[18px] accent-leaf"
        checked={agreed}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        I have read the{" "}
        <a href="/terms" target="_blank" rel="noopener">
          terms
        </a>{" "}
        and I am 18 or older.
      </span>
    </label>
  );
}

function SaveFailed() {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-destructive/40 bg-danger-wash px-4 py-3 text-sm"
    >
      <CircleAlert
        className="mt-[3px] size-4 flex-none text-destructive"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      Could not save your answer. Check your connection and try again.
    </div>
  );
}
