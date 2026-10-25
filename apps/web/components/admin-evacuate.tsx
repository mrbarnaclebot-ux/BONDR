"use client";
// UI-SPEC EVACUATE (ADMIN-11, D-35 to D-38): break glass for a master seed leak, last in the console. The typed
// phrase arms and simulates; the owner's fresh Phantom signature over the worker's intent is the confirmation,
// with no extra dialog. The input never submits on Enter: only the button acts.
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { EVAC_HINT, EVAC_PHRASE, evacDone, evacProgress, evacSummary } from "@/lib/admin-copy-evac";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { type EvacPhase, type EvacState, useEvacuate } from "@/lib/use-evacuate";
import { useAdmin } from "./admin-console";
import { Button } from "./ui-button";
import { Input } from "./ui-field";
import { useWallet } from "./wallet";

const BOX =
  "grid gap-8 rounded-lg border border-destructive/70 px-4 py-6 md:grid-cols-2 md:p-8 " +
  "[background:radial-gradient(70%_120%_at_0%_0%,color-mix(in_oklch,var(--destructive)_14%,transparent),transparent_60%),repeating-linear-gradient(-45deg,transparent_0_14px,color-mix(in_oklch,var(--destructive)_4%,transparent)_14px_28px),var(--surface)] " +
  "shadow-[0_30px_80px_-40px_color-mix(in_oklch,var(--destructive)_60%,transparent)] [&>*]:min-w-0";

type Tone = "plain" | "error" | "warn" | "info" | "done";
type Hint = { tone: Tone; text: string };
const ICON = { error: CircleAlert, warn: TriangleAlert, info: Info } as const;
const TINT: Record<Tone, string> = {
  plain: "text-muted-foreground",
  done: "text-foreground",
  error: "text-destructive",
  warn: "text-warn",
  info: "text-mint",
};

const PLAIN: Record<EvacPhase, string> = {
  ...{
    disarmed: EVAC_HINT.disarmed,
    again: EVAC_HINT.disarmed,
    done: EVAC_HINT.disarmed,
    lost: EVAC_HINT.lost,
  },
  ...{ simulating: EVAC_HINT.simulating, ready: EVAC_HINT.ready, signing: EVAC_HINT.signing },
  ...{ evacuating: EVAC_HINT.evacuating, nothing: EVAC_HINT.nothing },
};

// The UI-SPEC state table's hint column; simOnly replaces "Phantom will ask" because nothing can be signed.
function hintOf(s: EvacState, simOnly: boolean): Hint {
  if (s.note) return { tone: s.note.variant, text: s.note.text };
  if (s.phase === "ready" && simOnly) return { tone: "info", text: EVAC_HINT.simOnly };
  if (s.phase === "done" && s.view) return { tone: "done", text: evacDone(s.view) };
  return { tone: s.phase === "lost" ? "warn" : "plain", text: PLAIN[s.phase] };
}

function HintLine({ hint }: { hint: Hint }) {
  const Icon = hint.tone in ICON ? ICON[hint.tone as keyof typeof ICON] : null;
  return (
    <p
      id="evac-hint"
      role={hint.tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-1.5 text-xs", TINT[hint.tone])}
    >
      {Icon && <Icon className="mt-px size-3.5 flex-none" strokeWidth={1.5} aria-hidden="true" />}
      {hint.text}
    </p>
  );
}

function Summary({ s }: { s: EvacState }) {
  const totals = s.sim?.totals;
  const shown =
    s.phase === "ready" || s.phase === "signing" || s.phase === "evacuating" || s.phase === "lost";
  if (!shown || !totals) return null;
  const progress = s.view && evacProgress(s.view, totals.wallets);
  return (
    <p className="text-xs text-muted-foreground">
      {evacSummary(totals).map((p) => (
        <span key={p.post}>
          {p.pre}
          <span className="num text-foreground">{p.value}</span>
          {p.post}
        </span>
      ))}
      {progress && <span className="mt-1 block">{progress}</span>}
    </p>
  );
}

type Btn = { label: string; act?: "send" | "again" | "connect"; danger?: boolean; busy?: boolean };

// The state table's button column; danger only once the simulation passed with a sendable intent.
function buttonOf(s: EvacState, simOnly: boolean, connected: boolean): Btn {
  const sign = `Sign and evacuate ${s.sim?.totals?.wallets ?? 0} wallets`;
  if (s.phase === "again") return { label: "Simulate again", act: "again" };
  if (s.phase === "simulating") return { label: "Simulating…" };
  if (s.phase === "evacuating") return { label: "Evacuating…", busy: true };
  if (s.phase === "signing" || s.phase === "lost") return { label: sign, danger: true };
  if (s.phase !== "ready") return { label: "Sign and evacuate" };
  if (simOnly) return { label: "Simulation only on this deploy" };
  // The console's sign-in is a cookie only, so Phantom may not be connected yet (06-18).
  if (!connected) return { label: "Connect Phantom", act: "connect" };
  return { label: sign, act: "send", danger: true };
}

type Act = { simOnly: boolean; onSend(): void; onAgain(): void };

function EvacButton({ s, simOnly, onSend, onAgain }: { s: EvacState } & Act) {
  const wallet = useWallet();
  const b = buttonOf(s, simOnly, !!wallet.address);
  const on = { send: onSend, again: onAgain, connect: () => void wallet.connect() };
  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      variant={b.danger ? "danger" : "quiet"}
      disabled={!b.act}
      aria-busy={b.busy || undefined}
      onClick={b.act && on[b.act]}
    >
      {b.label}
    </Button>
  );
}

// The left column; the departure from the mockup's third line is D-36 (seed rotation is out of scope).
function Intro({ wallets }: { wallets: number }) {
  return (
    <div>
      <h2 id="evac-h" className="display text-[44px] leading-[0.95] tracking-[0.04em] text-destructive">
        EVACUATE
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        Break glass for a master seed leak. It cannot be undone.
      </p>
      <ol className="mt-2 list-decimal pl-[1.2em] text-sm text-muted-foreground">
        <li>Every job pauses, launches included.</li>
        <li>
          Every W balance moves to the treasury, {wallets} wallets. Child tokens in W are burned, not moved.
        </li>
        <li>
          Jobs stay paused until you turn each one back on. Rotating the master seed is a separate runbook.
        </li>
      </ol>
    </div>
  );
}

type EvacProps = { overview: AdminOverview; evacuate: "simulate" | "on" | undefined; onChanged(): void };

/** `evacuate` is the worker's ADMIN_EVACUATE from the health poll; unknown counts as simulate-only (D-37). */
export function Evacuate({ overview, evacuate, onChanged }: EvacProps) {
  const { onUnauthorized } = useAdmin();
  const run = useEvacuate(onUnauthorized, onChanged);
  const { s } = run;
  const simOnly = evacuate !== "on" || !s.sim?.intent;
  const armed = !["disarmed", "done", "nothing"].includes(s.phase);
  const locked = s.phase === "signing" || s.phase === "evacuating" || s.phase === "lost";
  return (
    <section aria-labelledby="evac-h" className={BOX}>
      <Intro wallets={overview.rows.length} />
      <div className="grid content-start gap-2">
        <label htmlFor="evac-in" className="block text-sm leading-[1.9] font-semibold">
          Type <span className="num bg-surface-2 px-1.5 py-0.5 select-all">{EVAC_PHRASE}</span> to arm
        </label>
        <Input
          id="evac-in"
          value={run.typed}
          readOnly={locked}
          onChange={(e) => run.type(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="evac-hint"
          className={cn(
            "num",
            armed &&
              "border-destructive focus:border-destructive focus:shadow-[0_0_0_3px_var(--danger-wash)]",
          )}
        />
        <HintLine hint={hintOf(s, simOnly)} />
        <Summary s={s} />
        <EvacButton s={s} simOnly={simOnly} onSend={run.send} onAgain={run.simulate} />
      </div>
    </section>
  );
}
