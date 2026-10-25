"use client";
// The owner console shell (D-06, D-10, D-11, UI-SPEC Top bar and Layout): the session line with a minute
// countdown, Refresh, Sign out, and the panel grid in the mockup order. Layout and mounts only: state lives in
// use-console.ts. Any 401 from a panel swaps the console for the sign-in card.
import { RefreshCw } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { clock } from "@/lib/admin-copy-health";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { type Console, useConsole } from "@/lib/use-console";
import { useHealth } from "@/lib/use-health";
import { AuditLog } from "./admin-audit";
import { AdminHealth } from "./admin-health";
import { type AdminSessionView, AdminSignIn, SignInAgain, type SignInNotice, SignOut } from "./admin-signin";
import { KillSwitches } from "./admin-switches";
import { AdminWallets } from "./admin-wallets";
import { WTable } from "./admin-wtable";
import { Callout } from "./callout";
import { Button } from "./ui-button";

export type ConsoleProps = AdminSessionView & { initial: AdminOverview; windowMs: number };

type Admin = AdminSessionView & { onUnauthorized(): void };
const AdminContext = createContext<Admin | null>(null);

/** The signed-in wallet, the cookie's expiry and onUnauthorized, for every panel inside the console. */
export function useAdmin(): Admin {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin needs AdminConsole");
  return admin;
}

export function AdminConsole({ wallet, exp, initial, windowMs }: ConsoleProps) {
  const [session, setSession] = useState<AdminSessionView>({ wallet, exp });
  const [gate, setGate] = useState<SignInNotice | null>(null);
  const resume = useCallback((s: AdminSessionView) => {
    setSession(s);
    setGate(null);
  }, []);
  const onUnauthorized = useCallback(() => setGate("ended"), []);
  const con = useConsole(initial, onUnauthorized, windowMs);
  if (gate) return <AdminSignIn configured notice={gate} onSignedIn={resume} />;
  return (
    <AdminContext value={{ ...session, onUnauthorized }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-8 pb-16 [&>*]:min-w-0">
        <div className="grid gap-4">
          <TopBar
            session={session}
            onRenew={resume}
            onEnd={onUnauthorized}
            onSignedOut={() => setGate("signedout")}
          >
            <Refresh con={con} />
          </TopBar>
          {con.failed && <Callout variant="error">Could not refresh. Try again.</Callout>}
        </div>
        <Grid con={con} onUnauthorized={onUnauthorized} windowMs={windowMs} />
      </div>
    </AdminContext>
  );
}

// UI-SPEC Layout, DOM order equals visual order. Mounted only while signed in, so the health poll stops with the
// session. Later plans fill the commented slots.
function Grid({ con, onUnauthorized, windowMs }: { con: Console; onUnauthorized(): void; windowMs: number }) {
  const poll = useHealth(onUnauthorized);
  const { overview, loading } = con;
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 min-[68.75rem]:grid-cols-[1.1fr_1fr_1.2fr] [&>*]:min-w-0">
        <AdminWallets overview={overview} busy={loading} />
        <KillSwitches poll={poll} onChanged={con.reload} />
        <AdminHealth
          poll={poll}
          overview={overview}
          busy={loading}
          className="md:col-span-2 min-[68.75rem]:col-span-1"
          onSelect={con.select}
        />
      </div>
      <WTable
        overview={overview}
        busy={loading}
        windowMs={windowMs}
        selected={con.selected}
        onSelect={con.select}
      />
      {/* 06-17: a row "grid gap-8 min-[68.75rem]:grid-cols-[1.3fr_1fr] min-[68.75rem]:items-start [&>*]:min-w-0"
          holding <AdminTimeline />, then a "grid gap-8" stack of <AdminInspect /> (06-19) and <AdminModeration />
          (06-20) */}
      <AuditLog key={overview.loadedAt} overview={overview} busy={loading} />
      {/* 06-23: <Evacuate /> */}
    </>
  );
}

// UI-SPEC Refresh control: the one way a user reloads the Postgres panels. "Loaded" is local time, so it renders
// after mount (the server's time zone would differ).
function Refresh({ con }: { con: Console }) {
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

function TopBar({ session, onRenew, onEnd, onSignedOut, children }: TopBarProps) {
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
