"use client";
// UI-SPEC Audit log (ADMIN-10, D-33): every admin action, newest first. The first 50 come with the overview
// load; older pages load only on the Load more click, never on a timer. The console remounts this panel on each
// overview load (key), so older pages drop and the newest page shows the action that just settled.
import type { Net } from "@bondr/core/api";
import type { AdminAuditRow } from "@bondr/core/api-admin";
import { useEffect, useState } from "react";
import { auditActionCopy, auditResult, auditSim, auditTime, type Word } from "@/lib/admin-copy-audit";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { short } from "@/lib/format";
import { useAdmin } from "./admin-console";
import { Panel, TONE } from "./admin-panel";
import { LoadMore } from "./token-trades";
import { TxLink } from "./tx-link";

const COPY = {
  more: "Load 50 older entries",
  end: "That is every admin action.",
  error: "Could not load older entries. Try again.",
};
const TH = "py-2 pr-4 text-left font-semibold tracking-[0.05em] uppercase";
const TD = "border-t border-line py-2 pr-4";
// The sticky Time column needs an opaque fill so rows scrolling under it stay readable.
const STICKY = "sticky left-0 z-10 bg-surface";

type Page = AdminOverview["audit"];

function useOlder(initial: Page) {
  const { onUnauthorized } = useAdmin();
  const [page, setPage] = useState(initial);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function load() {
    if (!page.next) return;
    setState("loading");
    const r = await fetch("/api/admin/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ before: page.next }),
      cache: "no-store",
    }).catch(() => null);
    if (r?.status === 401) return onUnauthorized();
    const older = r?.ok ? ((await r.json().catch(() => null)) as Page | null) : null;
    if (!older) return setState("error");
    setPage((p) => ({ rows: [...p.rows, ...older.rows], more: older.more, next: older.next }));
    setState("idle");
  }
  return { ...page, state, load };
}

const Cell = ({ w }: { w: Word }) => <span className={TONE[w.tone]}>{w.text}</span>;

function Sigs({ sigs, net }: { sigs: string[]; net: Net }) {
  if (!sigs.length) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <TxLink signature={sigs[0]} net={net}>
        {short(sigs[0])}
      </TxLink>
      {sigs.length > 1 && <span className="text-muted-foreground">{`+${sigs.length - 1}`}</span>}
    </span>
  );
}

// `now` is 0 until mount: times are the viewer's local zone, which the server cannot know.
function Row({ r, net, now }: { r: AdminAuditRow; net: Net; now: number }) {
  return (
    <tr>
      <td className={cn(TD, STICKY, "num text-muted-foreground")}>
        <time dateTime={r.at} title={now ? new Date(r.at).toLocaleString() : undefined}>
          {now ? auditTime(r.at, now) : " "}
        </time>
      </td>
      <td className={cn(TD, "num")}>{short(r.actor)}</td>
      <td className={cn(TD, "text-[13px]")}>{auditActionCopy(r)}</td>
      <td className={TD}>
        <Cell w={auditSim(r.simulation)} />
      </td>
      <td className={TD}>
        <Cell w={auditResult(r.result)} />
      </td>
      <td className={TD}>
        <Sigs sigs={r.sigs} net={net} />
      </td>
    </tr>
  );
}

function Table({ rows, net }: { rows: AdminAuditRow[]; net: Net }) {
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  return (
    // A named section is a region; tabIndex lets a keyboard user scroll the wide table sideways.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
    <section aria-label="Audit log table, scrolls sideways" tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-xs">
        <caption className="sr-only">Admin actions, newest first</caption>
        <thead className="text-muted-foreground">
          <tr>
            {["Time", "Actor", "Action", "Simulation", "Result", "Signature"].map((h, i) => (
              <th key={h} scope="col" className={cn(TH, i === 0 && STICKY)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.id} r={r} net={net} now={now} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AuditLog({ overview, busy }: { overview: AdminOverview; busy: boolean }) {
  const { rows, more, state, load } = useOlder(overview.audit);
  const failed = overview.loadedAt === 0;
  return (
    <Panel id="audit-h" title="Audit log" note="every admin action, with its simulation" busy={busy}>
      {rows.length > 0 ? (
        <Table rows={rows} net={overview.net} />
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {failed
            ? "Could not load the audit log. Refresh to try again."
            : "No admin actions yet. Every action you take here is recorded with its simulation and signature."}
        </p>
      )}
      <LoadMore shown={rows.length > 0} more={more} state={state} load={() => void load()} copy={COPY} />
    </Panel>
  );
}
