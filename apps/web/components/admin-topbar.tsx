"use client";
// UI-SPEC Top bar (D-10): the session line with a minute countdown (not a live region), Sign in again under 5
// minutes and Sign out; split from admin-console.tsx to keep the shell under 200 lines.
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { type AdminSessionView, SignInAgain, SignOut } from "./admin-signin";

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
