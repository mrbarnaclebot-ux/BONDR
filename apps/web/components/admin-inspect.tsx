"use client";
// UI-SPEC Transaction inspector (ADMIN-09, D-32): paste any signature on this cluster and read the worker's
// decode. The worker answers labelled strings only, so no program id lives in this bundle; every line renders as
// React text, never HTML (T-06-21-02).
import type { AdminInspect as Inspect } from "@bondr/core/api-admin";
import { type FormEvent, Fragment, useState } from "react";
import type { AdminOverview } from "@/lib/admin-data";
import { short } from "@/lib/format";
import { useAdmin } from "./admin-console";
import { Panel, TONE } from "./admin-panel";
import { Button } from "./ui-button";
import { FieldError, Input, Label } from "./ui-field";

type Found = Inspect & { found: true; status: "success" | "failed" };

const SIG = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/; // 64 bytes of base58
const INVALID = "That is not a transaction signature.";
const NOT_FOUND = "Transaction not found. It may be too new, too old for this RPC, or on another cluster.";
const RPC = "Could not reach the RPC. Try again.";
const PRE =
  "num mt-3 rounded-sm bg-surface p-4 text-xs leading-[1.7] whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere] [&_b]:font-semibold [&_b]:text-foreground";
const LINK = "text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground";

type Reply = { status: number; body: Inspect | null };
async function decode(signature: string): Promise<Reply> {
  const r = await fetch("/api/admin/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature }),
    cache: "no-store",
  }).catch(() => null);
  const body = r?.ok ? ((await r.json().catch(() => null)) as Inspect | null) : null;
  return { status: r?.status ?? 0, body };
}

// "W {SYMBOL}" when the payer is a coin's W, by the worker's mint or the overview's W column.
function payerLabel(r: Found, rows: AdminOverview["rows"]): string {
  const p = r.feePayer;
  if (!p) return "";
  const row = rows.find((x) => (p.mint && x.mint === p.mint) || x.w === p.address);
  const label = row ? `W ${row.symbol}` : p.label;
  return label ? `${label} ${short(p.address)}` : short(p.address);
}

function Output({ r, payer }: { r: Found; payer: string }) {
  return (
    <pre className={PRE}>
      <b>Status</b>
      {"  "}
      <span className={r.status === "failed" ? TONE.danger : TONE.ok}>{r.status}</span>
      {`, slot ${(r.slot ?? 0).toLocaleString("en-US")}\n`}
      <b>Fee payer</b>
      {`  ${payer}\n`}
      {r.instructions?.map((ix) => (
        <Fragment key={ix.index}>
          <b>{`#${ix.index}`}</b>
          {`  ${ix.program}${ix.name ? `: ${ix.name}` : ""}\n`}
          {ix.args.map((a) => `     ${a}\n`).join("")}
        </Fragment>
      ))}
      {r.error && (
        <>
          <b>Error</b>
          {"  "}
          <span className={TONE.danger}>{r.error}</span>
          {"\n"}
        </>
      )}
      <a href={r.explorer} target="_blank" rel="noopener" className={LINK}>
        Open in Solscan<span className="sr-only">{" (opens Solscan)"}</span>
      </a>
    </pre>
  );
}

function useInspect() {
  const { onUnauthorized } = useAdmin();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Found | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const sig = value.trim();
    setInvalid(!SIG.test(sig));
    setError("");
    if (!SIG.test(sig)) return; // T-06-21-01: no request for a non-signature
    setBusy(true);
    const r = await decode(sig);
    setBusy(false);
    if (r.status === 401) return onUnauthorized();
    if (r.status === 400) return setInvalid(true);
    setResult(r.body?.found ? (r.body as Found) : null);
    if (!r.body) setError(RPC);
    else if (!r.body.found) setError(NOT_FOUND);
  }
  return { value, setValue, busy, invalid, error, result, submit };
}

export function AdminInspect({ overview }: { overview: AdminOverview }) {
  const s = useInspect();
  const n = s.result?.instructions?.length ?? 0;
  return (
    <Panel id="inspect-h" title="Transaction inspector">
      <form noValidate onSubmit={(e) => void s.submit(e)} className="grid gap-2">
        <Label htmlFor="inspect-sig">Paste a transaction signature</Label>
        <div className="grid gap-2 md:flex md:items-start">
          <Input
            id="inspect-sig"
            className="num md:flex-1"
            value={s.value}
            onChange={(e) => s.setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={s.invalid || undefined}
            aria-describedby={s.invalid ? "inspect-sig-err" : undefined}
          />
          <Button type="submit" className="w-full md:min-h-12 md:w-auto" disabled={s.busy} aria-busy={s.busy}>
            {s.busy ? "Decoding…" : "Decode"}
          </Button>
        </div>
        <FieldError id="inspect-sig-err" message={s.invalid ? INVALID : undefined} />
      </form>
      {s.error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {s.error}
        </p>
      )}
      {s.result ? (
        <Output r={s.result} payer={payerLabel(s.result, overview.rows)} />
      ) : (
        !s.error && (
          <p className="mt-3 text-xs text-muted-foreground">
            Works for any signature on this cluster, not only BONDR's.
          </p>
        )
      )}
      <p role="status" className="sr-only">
        {s.result ? `Decoded. Status ${s.result.status}, ${n} instructions.` : ""}
      </p>
    </Panel>
  );
}
