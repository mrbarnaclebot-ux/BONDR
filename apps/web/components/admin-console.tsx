"use client";
// The owner console shell (D-10, D-11, UI-SPEC Top bar): the session line with a minute countdown, Sign out,
// and the grid later plans render panels into. Any 401 from a panel swaps the console for the sign-in card.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { type AdminSessionView, AdminSignIn, type SignInNotice, useAdminSignIn } from "./admin-signin";
import { Callout } from "./callout";
import { useWallet } from "./wallet";

export type ConsoleProps = AdminSessionView & { children?: ReactNode };

type Admin = AdminSessionView & { onUnauthorized(): void };
const AdminContext = createContext<Admin | null>(null);

/** The signed-in wallet, the cookie's expiry and onUnauthorized, for every panel inside the console. */
export function useAdmin(): Admin {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin needs AdminConsole");
  return admin;
}

const LINK =
  "inline-flex min-h-11 cursor-pointer items-center text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground disabled:cursor-not-allowed md:min-h-6";

export function AdminConsole({ wallet, exp, children }: ConsoleProps) {
  const [session, setSession] = useState<AdminSessionView>({ wallet, exp });
  const [gate, setGate] = useState<SignInNotice | null>(null);
  const resume = useCallback((s: AdminSessionView) => {
    setSession(s);
    setGate(null);
  }, []);
  const onUnauthorized = useCallback(() => setGate("ended"), []);
  if (gate) return <AdminSignIn configured notice={gate} onSignedIn={resume} />;
  return (
    <AdminContext value={{ ...session, onUnauthorized }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-8 pb-16 [&>*]:min-w-0">
        <TopBar
          session={session}
          onRenew={resume}
          onEnd={onUnauthorized}
          onSignedOut={() => setGate("signedout")}
        />
        {children}
      </div>
    </AdminContext>
  );
}

/** Milliseconds to exp, re-read when the remaining time crosses a whole minute. Not a live region. */
function useLeft(exp: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = exp - now;
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), left % 60_000 || 60_000);
    return () => clearTimeout(t);
  }, [left]);
  return left;
}

const minutes = (left: number): string => (left < 60_000 ? "<1m" : `${Math.floor(left / 60_000)}m`);

type TopBarProps = {
  session: AdminSessionView;
  onRenew(s: AdminSessionView): void;
  onEnd(): void;
  onSignedOut(): void;
};

function TopBar({ session, onRenew, onEnd, onSignedOut }: TopBarProps) {
  const left = useLeft(session.exp);
  const warn = left < 5 * 60_000;
  useEffect(() => {
    if (left <= 0) onEnd();
  }, [left, onEnd]);
  return (
    <div className="grid gap-4 md:flex md:flex-wrap md:items-end md:justify-between">
      <h1 className="display text-[44px] leading-[0.95]">Owner console</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Signed in <span className="num text-foreground">{short(session.wallet)}</span>, the allowlisted
          wallet
        </span>
        <span className={cn(warn && "text-warn")}>
          Session ends in{" "}
          <span className={cn("num", warn ? "text-warn" : "text-foreground")} suppressHydrationWarning>
            {minutes(left)}
          </span>
        </span>
        {warn && <SignInAgain onRenew={onRenew} />}
        <span>Every money move asks for a fresh signature</span>
        <SignOut onSignedOut={onSignedOut} />
      </div>
    </div>
  );
}

// A fresh 30-minute cookie from a new signature, in place; the countdown restarts from its expiry.
function SignInAgain({ onRenew }: { onRenew(s: AdminSessionView): void }) {
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

function SignOut({ onSignedOut }: { onSignedOut(): void }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "signout" }),
      cache: "no-store",
    }).catch(() => null);
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
