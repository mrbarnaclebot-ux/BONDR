"use client";
// The owner sign-in card (ADMIN-01, D-08 to D-11): connect Phantom, sign the server's admin message verbatim,
// and the server sets the 30-minute bondr_admin cookie. Admin sign-in does not wait on consent.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { short } from "@/lib/format";
import { Callout } from "./callout";
import { Button } from "./ui-button";
import { rejected, useWallet, type WalletApi } from "./wallet";

export type AdminSessionView = { wallet: string; exp: number };

const FAULTS = {
  not_admin: "This wallet is not the admin wallet. Switch accounts in Phantom and try again.",
  rejected: "Phantom rejected the request. You are not signed in.",
  failed: "Could not sign in. Check your connection and try again.",
  limited: "Too many sign-in attempts. Wait a minute and try again.",
  expired: "That signature expired or was already used. Sign in again.",
};
type Fault = keyof typeof FAULTS;

const NOTICES = {
  ended: "Your admin session ended after 30 minutes. Sign in again.",
  signedout: "Signed out.",
  lost: "Your admin session ended during a send. It may still finish on the worker, and nothing is resent. Check the audit log before you run it again.",
};
export type SignInNotice = keyof typeof NOTICES;

const post = (body: object) =>
  fetch("/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);

const BY_CODE = new Map<unknown, Fault>([
  ["not_admin", "not_admin"],
  ["bad_signature", "expired"], // a replayed or expired nonce after a slow Phantom prompt (IN-B-06)
]);
const faultOf = (res: Response | null, body: { error?: unknown } | null): Fault =>
  res?.status === 429 ? "limited" : (BY_CODE.get(body?.error) ?? "failed");

/** Nonce, one signature over the server's message text, verify. The cookie arrives with the verify answer. */
async function signInAdmin(
  wallet: string,
  signMessage: WalletApi["signMessage"],
): Promise<AdminSessionView | Fault> {
  const got = await post({ op: "nonce", wallet });
  const n = (await got?.json().catch(() => null)) as {
    nonce?: string;
    message?: string;
    error?: unknown;
  } | null;
  if (!got?.ok || !n?.nonce || !n.message) return faultOf(got, n);
  const message = new TextEncoder().encode(n.message);
  const sig = await signMessage(message).catch((e: unknown) => (rejected(e) ? "rejected" : "failed"));
  if (typeof sig === "string") return sig;
  const signature = btoa(String.fromCharCode(...sig));
  const res = await post({ op: "verify", wallet, nonce: n.nonce, signature });
  const out = (await res?.json().catch(() => null)) as
    | (Partial<AdminSessionView> & { error?: unknown })
    | null;
  if (res?.ok && typeof out?.wallet === "string" && typeof out.exp === "number")
    return { wallet: out.wallet, exp: out.exp };
  return faultOf(res, out);
}

/** The sign-in flow, shared by the card and the console's in-place "Sign in again" (no sliding renewal, D-10). */
export function useAdminSignIn(onSignedIn: (s: AdminSessionView) => void) {
  const { address, signMessage } = useWallet();
  const [state, setState] = useState<"idle" | "signing" | Fault>("idle");
  const signIn = async () => {
    if (!address) return;
    setState("signing");
    const out = await signInAdmin(address, signMessage);
    if (typeof out === "string") return setState(out);
    setState("idle");
    onSignedIn(out);
  };
  const fault = state === "idle" || state === "signing" ? null : FAULTS[state];
  return { signing: state === "signing", idle: state === "idle", fault, signIn };
}

type Props = { configured: boolean; notice?: SignInNotice; onSignedIn?(s: AdminSessionView): void };

export function AdminSignIn({ configured, notice, onSignedIn }: Props) {
  const router = useRouter();
  // From the page, a fresh server render swaps this card for the console.
  const flow = useAdminSignIn(onSignedIn ?? (() => router.refresh()));
  return (
    <div className="mx-auto grid w-[min(480px,100%)] gap-6 pt-16 pb-16">
      <h1 className="display text-[44px] leading-[0.95]">Owner console</h1>
      <section
        aria-labelledby="signin-h"
        className="grid gap-4 rounded-lg border border-line bg-[linear-gradient(180deg,color-mix(in_oklch,var(--surface-2)_85%,transparent),color-mix(in_oklch,var(--surface)_92%,transparent))] p-4 shadow-elev-2 md:p-6"
      >
        <h2 id="signin-h" className="display text-[28px] leading-none">
          {configured ? "Sign in" : "Admin is not configured"}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {configured
            ? "Connect the admin wallet in Phantom, then sign a short message. It is not a transaction and costs nothing."
            : "This console stays closed until the admin wallet is set on the web app and the worker."}
        </p>
        {configured && notice && flow.idle && <Callout>{NOTICES[notice]}</Callout>}
        {configured && flow.fault && <Callout variant="error">{flow.fault}</Callout>}
        {configured && <SignInButton flow={flow} />}
      </section>
    </div>
  );
}

function SignInButton({ flow }: { flow: ReturnType<typeof useAdminSignIn> }) {
  const { status, address, connect } = useWallet();
  const props = { type: "button", variant: "primary", size: "lg" } as const;
  if (status !== "connected" || !address)
    return (
      <Button {...props} disabled={status !== "idle"} onClick={connect}>
        Connect Phantom
      </Button>
    );
  return (
    <Button {...props} disabled={flow.signing} aria-busy={flow.signing} onClick={flow.signIn}>
      {flow.signing ? "Waiting for Phantom…" : `Sign in as ${short(address)}`}
    </Button>
  );
}

// The top bar's session controls, beside the card that shares their sign-in flow.
const LINK =
  "inline-flex min-h-11 cursor-pointer items-center text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground disabled:cursor-not-allowed md:min-h-6";

// A fresh 30-minute cookie from a new signature, in place; the countdown restarts from its expiry.
export function SignInAgain({ onRenew }: { onRenew(s: AdminSessionView): void }) {
  const { address, connect } = useWallet();
  const flow = useAdminSignIn(onRenew);
  return (
    <>
      <button
        type="button"
        className={LINK}
        disabled={flow.signing}
        aria-busy={flow.signing}
        onClick={address ? flow.signIn : connect}
      >
        Sign in again
      </button>
      {flow.fault && (
        <Callout variant="error" className="mt-2 basis-full">
          {flow.fault}
        </Callout>
      )}
    </>
  );
}

export function SignOut({ onSignedOut }: { onSignedOut(): void }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    const res = await post({ op: "signout" });
    setBusy(false);
    // Only once the clearing cookie has landed; otherwise the console stays and Sign out can be pressed again.
    if (res?.ok) onSignedOut();
  };
  return (
    <button type="button" className={LINK} disabled={busy} aria-busy={busy} onClick={signOut}>
      Sign out
    </button>
  );
}
