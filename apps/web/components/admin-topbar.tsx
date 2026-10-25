"use client";
// UI-SPEC Top bar (D-10): the session line with a minute countdown (not a live region), Sign in again under 5
// minutes, Sign out and Refresh; split from admin-console.tsx to keep the shell under 150 lines.
import { RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { clock } from "@/lib/admin-copy-health";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import type { Console } from "@/lib/use-console";
import { type AdminSessionView, SignInAgain, SignOut } from "./admin-signin";
import { Button } from "./ui-button";

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
  children: ReactNode;
  onRenew(s: AdminSessionView): void;
  onEnd(): void;
  onSignedOut(): void;
};

export function TopBar({ session, onRenew, onEnd, onSignedOut, children }: TopBarProps) {
  const left = useLeft(session.exp);
  const warn = left < 5 * 60_000;
  useEffect(() => {
    if (left <= 0) onEnd();
  }, [left, onEnd]);
  return (
    <div className="grid gap-4 md:flex md:flex-wrap md:items-end md:justify-between">
      <h1 className="display text-[44px] leading-[0.95]">Owner console</h1>
      <div className="grid gap-3 md:flex md:flex-wrap md:items-center md:justify-end md:gap-x-6">
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
        {children}
      </div>
    </div>
  );
}

// UI-SPEC Refresh control: the one way a user reloads the Postgres panels. "Loaded" is local time, so it renders
// after mount (the server's time zone would differ).
export function Refresh({ con }: { con: Console }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const at = con.overview.loadedAt;
  return (
    <div className="grid gap-1 md:flex md:items-center md:gap-3">
      <Button
        className="w-full md:min-h-9 md:w-auto"
        disabled={con.loading}
        aria-busy={con.loading}
        onClick={() => void con.refresh()}
      >
        <RefreshCw strokeWidth={1.5} aria-hidden="true" />
        {con.loading ? "Refreshing…" : "Refresh"}
      </Button>
      <span className="text-xs text-muted-foreground">
        {!mounted ? "\u00a0" : at > 0 ? `Loaded ${clock(at, false)}` : "Not loaded"}
      </span>
    </div>
  );
}
