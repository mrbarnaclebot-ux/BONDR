"use client";
// UI-SPEC Kill switches (ADMIN-05, D-13, D-18, D-19): five jobs, each flipped at once with no dialog and no fresh
// signature; the worker writes the DB, then memory, then one landed audit row. Values come from the 10 s health
// poll (worker memory), except while a flip is in flight or when the flip's answer is newer than the last poll.
import type { AdminJob, AdminSwitches } from "@bondr/core/api-admin";
import { useState } from "react";
import { auditTime, JOB_LABEL } from "@/lib/admin-copy-audit";
import { cn } from "@/lib/cn";
import { utcStamp } from "@/lib/format";
import type { HealthPoll } from "@/lib/use-health";
import { useAdmin } from "./admin-console";
import { Panel, TONE } from "./admin-panel";
import { Callout } from "./callout";

const JOBS = Object.keys(JOB_LABEL) as AdminJob[];

type Answer = { at: number; switches: AdminSwitches };

async function post(
  job: AdminJob,
  enabled: boolean,
): Promise<{ status: number; body: AdminSwitches | null }> {
  const r = await fetch("/api/admin/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job, enabled }),
    cache: "no-store",
  }).catch(() => null);
  const body = r?.ok ? ((await r.json().catch(() => null)) as AdminSwitches | null) : null;
  return { status: r?.status ?? 0, body };
}

function useFlips(poll: HealthPoll, onChanged: () => void) {
  const { onUnauthorized } = useAdmin();
  const [saving, setSaving] = useState<Partial<Record<AdminJob, boolean>>>({});
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<AdminJob | null>(null);
  const known = answer && answer.at > (poll.lastOk ?? 0) ? answer.switches : poll.health?.switches;
  async function flip(job: AdminJob, enabled: boolean) {
    setError(null);
    setSaving((s) => ({ ...s, [job]: enabled }));
    const r = await post(job, enabled);
    setSaving(({ [job]: _, ...rest }) => rest);
    if (r.status === 401) return onUnauthorized();
    if (!r.body) return setError(job);
    setAnswer({ at: Date.now(), switches: r.body });
    onChanged(); // the audit log shows the new row (D-21)
  }
  // An in-flight flip shows its target, so a poll landing mid-flight never flips the switch back.
  const shown = (job: AdminJob): boolean | undefined => saving[job] ?? known?.[job];
  return { shown, saving, error, flip };
}

type RowProps = { job: AdminJob; on: boolean | undefined; busy: boolean; onFlip(on: boolean): void };

function Row({ job, on, busy, onFlip }: RowProps) {
  const id = `switch-${job}`;
  const disabled = busy || on === undefined;
  const [word, tone] = busy
    ? (["Saving…", TONE.muted] as const)
    : on === undefined
      ? (["Unknown", TONE.muted] as const)
      : on
        ? (["Running", TONE.ok] as const)
        : (["Paused", TONE.warn] as const);
  return (
    <div className="grid grid-cols-[1fr_auto_48px] items-center gap-2 border-b border-line py-3">
      <span id={id} className="text-[13px] font-semibold">
        {JOB_LABEL[job]}
      </span>
      <span className={cn("text-xs font-semibold tracking-[0.06em] uppercase", tone)}>{word}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-labelledby={id}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && onFlip(!on)}
        className="group grid h-11 w-12 cursor-pointer place-items-center aria-disabled:cursor-not-allowed"
      >
        <span className="relative h-7 w-12 rounded-full border border-line-strong bg-surface-2 transition-colors duration-(--dur) group-aria-checked:border-secondary group-aria-checked:bg-secondary group-aria-disabled:opacity-60 motion-reduce:transition-none">
          <span className="absolute top-[3px] left-[3px] size-5 rounded-full bg-muted-foreground transition-[translate,background-color] duration-[260ms] ease-out group-aria-checked:translate-x-5 group-aria-checked:bg-foreground motion-reduce:transition-none" />
        </span>
      </button>
    </div>
  );
}

function Notices({ poll }: { poll: HealthPoll }) {
  const h = poll.health;
  if (!h) return null;
  const c = h.contract;
  return (
    <>
      {c.kind === "mismatch" && (
        // Keyed by the run, so a new mismatch mounts a new alert and is announced once (D-20).
        <Callout key={c.at} variant="error" title="The pump contract check failed." className="mb-4">
          {`Every job was paused at ${c.at ? auditTime(c.at, Date.now()) : "the last check"}. The failed facts are in Health. Turn jobs back on one at a time once you have reviewed them. Launches stay paused until Run check now passes.`}
        </Callout>
      )}
      {h.feeEngine !== "on" && (
        <Callout variant="warn" className="mb-4">
          {`The fee engine is ${h.feeEngine === "off" ? "off" : "in dry run"} for this deploy. Fee switches take effect when it is on.`}
        </Callout>
      )}
      {h.evacuatedAt && (
        <Callout variant="warn" className="mb-4">
          {`Evacuated ${utcStamp(h.evacuatedAt)} UTC. Every job stays paused until you turn it back on, one at a time.`}
        </Callout>
      )}
    </>
  );
}

export function KillSwitches({ poll, onChanged }: { poll: HealthPoll; onChanged(): void }) {
  const { shown, saving, error, flip } = useFlips(poll, onChanged);
  return (
    <Panel id="switches-h" title="Kill switches" note="per job">
      <Notices poll={poll} />
      <div>
        {JOBS.map((job) => (
          <Row
            key={job}
            job={job}
            on={shown(job)}
            busy={saving[job] !== undefined}
            onFlip={(on) => void flip(job, on)}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {`Could not change ${JOB_LABEL[error]}. Try again.`}
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Pausing a job never moves funds. Recovery actions still run while a job is paused.
        </p>
      )}
    </Panel>
  );
}
