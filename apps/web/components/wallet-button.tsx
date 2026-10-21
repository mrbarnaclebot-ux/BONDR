"use client";
import { Wallet } from "lucide-react";
import { useRef, useState } from "react";
import { short } from "@/lib/format";
import { buttonVariants } from "./ui-button";
import { useWallet } from "./wallet";

// The consent dialog returns focus here by id, whichever state the control is in.
export const WALLET_BUTTON_ID = "wallet-button";
const ANCHOR = "[anchor-name:--wallet]";
const POPOVER =
  "inset-auto m-0 mt-2 [position-anchor:--wallet] [position-area:bottom_span-left] rounded-md border border-line-strong bg-surface-2 text-foreground shadow-elev-2";
const ITEM =
  "flex min-h-11 w-full cursor-pointer items-center rounded-sm px-3 text-left text-sm font-semibold hover:bg-accent";

export const focusButton = () =>
  requestAnimationFrame(() => document.getElementById(WALLET_BUTTON_ID)?.focus());
const icon = <Wallet strokeWidth={1.5} aria-hidden="true" />;

export function WalletButton() {
  const { status, address, connect } = useWallet();
  if (status === "connected" && address) return <ConnectedMenu address={address} />;
  if (status === "missing") return <MissingPopover />;
  const loading = status === "loading"; // before hydration and during the grace period
  return (
    <button
      id={WALLET_BUTTON_ID}
      type="button"
      className={buttonVariants({ variant: "quiet" })}
      disabled={status === "connecting"}
      aria-disabled={loading || undefined}
      onClick={() => status === "idle" && connect()}
    >
      {icon}
      <span>
        {status === "connecting" ? "Opening" : "Connect"}
        <span className="max-sm:sr-only"> Phantom</span>
        {status === "connecting" && "…"}
      </span>
    </button>
  );
}

function ConnectedMenu({ address }: { address: string }) {
  const { disconnect } = useWallet();
  const menu = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(address).then(
      () => setCopied(true),
      () => {},
    );
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <>
      <button
        id={WALLET_BUTTON_ID}
        type="button"
        popoverTarget="wallet-menu"
        className={`${buttonVariants({ variant: "solid" })} ${ANCHOR}`}
      >
        <span className="num">{short(address)}</span>
      </button>
      <div id="wallet-menu" ref={menu} popover="auto" className={`${POPOVER} min-w-52 p-1.5`}>
        <button type="button" className={ITEM} onClick={copy}>
          Copy address
        </button>
        <button
          type="button"
          className={ITEM}
          onClick={() => {
            menu.current?.hidePopover();
            disconnect().then(focusButton);
          }}
        >
          Disconnect
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Address copied" : ""}
        </span>
      </div>
    </>
  );
}

function MissingPopover() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const browse = `https://phantom.com/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
  return (
    <>
      <button
        id={WALLET_BUTTON_ID}
        type="button"
        popoverTarget="wallet-missing"
        className={`${buttonVariants({ variant: "quiet" })} ${ANCHOR}`}
      >
        {icon}
        <span>
          Connect<span className="max-sm:sr-only"> Phantom</span>
        </span>
      </button>
      <div
        id="wallet-missing"
        popover="auto"
        className={`${POPOVER} w-[min(320px,calc(100vw-32px))] gap-3 p-4 open:grid`}
      >
        <p className="text-sm">Phantom is not installed. BONDR works with the Phantom wallet only.</p>
        {mobile && (
          <a href={browse} className={buttonVariants({ variant: "primary" })}>
            Open BONDR in Phantom
          </a>
        )}
        <a
          href="https://phantom.com/download"
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "quiet" })}
        >
          Get Phantom<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </>
  );
}
