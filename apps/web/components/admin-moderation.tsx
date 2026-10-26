"use client";
// UI-SPEC Moderation (ADMIN-07, D-13, D-29, D-30): hide a coin from lists and block a deployer, each at once with
// no dialog because both are reversible; the worker writes one landed audit row per change. The reasons render
// only here, never on a public page.
import type { ModerationResult } from "@bondr/core/api-admin";
import { type ComponentProps, type FormEvent, useState } from "react";
import { coinLabel, type ModField, moderationDone, moderationError } from "@/lib/admin-copy-mod";
import type { AdminOverview } from "@/lib/admin-data";
import { cn } from "@/lib/cn";
import { age, short } from "@/lib/format";
import { useAdmin } from "./admin-console";
import { Panel } from "./admin-panel";
import { Button } from "./ui-button";
import { FieldError, Input, Label } from "./ui-field";

type Op = "hide" | "unhide" | "block" | "unblock";
type Body = { op: Op; query?: string; mint?: string; wallet?: string; reason?: string };
type Reply = { status: number; result: ModerationResult | null };

const FAILED = "Could not save. Try again.";
const LINK =
  "min-h-11 cursor-pointer text-xs text-mint underline decoration-1 underline-offset-[3px] hover:text-foreground disabled:cursor-not-allowed md:min-h-6";

async function moderate(body: Body): Promise<Reply> {
  const r = await fetch("/api/admin/moderate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  const result = r?.ok ? ((await r.json().catch(() => null)) as ModerationResult | null) : null;
  return { status: r?.status ?? 0, result };
}

type FormSpec = {
  op: "hide" | "block";
  target: Exclude<ModField, "reason">;
  label: string;
  placeholder: string;
  button: string;
};

const FORMS: FormSpec[] = [
  {
    op: "hide",
    target: "query",
    label: "Hide a coin from lists",
    placeholder: "Symbol or mint",
    button: "Hide coin",
  },
  {
    op: "block",
    target: "wallet",
    label: "Block a deployer from launching",
    placeholder: "Wallet address",
    button: "Block wallet",
  },
];

type Errors = Partial<Record<ModField | "form", string>>;

function useForm(f: FormSpec, done: (op: FormSpec["op"], value: string) => void) {
  const { onUnauthorized } = useAdmin();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setErrors({});
    setSaving(true);
    const r = await moderate({ op: f.op, [f.target]: value.trim(), reason });
    setSaving(false);
    if (r.status === 401) return onUnauthorized();
    if (!r.result) return setErrors({ form: FAILED });
    if (!r.result.ok) {
      const { field, text } = moderationError(r.result, value);
      return setErrors({ [field]: text });
    }
    done(f.op, value.trim());
    setValue("");
    setReason("");
  }
  return { value, setValue, reason, setReason, saving, errors, submit };
}

type FieldProps = Omit<ComponentProps<typeof Input>, "onChange"> & {
  id: string;
  label: string;
  error?: string;
  onValue(v: string): void;
};

function Field({ id, label, error, onValue, ...input }: FieldProps) {
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        onChange={(e) => onValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...input}
      />
      <FieldError id={`${id}-err`} message={error} />
    </>
  );
}

function ModForm({ f, done }: { f: FormSpec; done: (op: FormSpec["op"], value: string) => void }) {
  const s = useForm(f, done);
  return (
    <form noValidate onSubmit={(e) => void s.submit(e)} className="grid gap-2">
      <Field
        id={`mod-${f.op}-${f.target}`}
        label={f.label}
        placeholder={f.placeholder}
        value={s.value}
        onValue={s.setValue}
        error={s.errors[f.target]}
        className={cn(f.target === "wallet" && "num")}
      />
      <Field
        id={`mod-${f.op}-reason`}
        label="Reason, shown only here"
        value={s.reason}
        onValue={s.setReason}
        error={s.errors.reason}
        maxLength={120}
        aria-required="true"
      />
      {s.errors.form && (
        <p role="alert" className="text-xs text-destructive">
          {s.errors.form}
        </p>
      )}
      <Button type="submit" className="justify-self-end" disabled={s.saving} aria-busy={s.saving}>
        {s.saving ? "Saving…" : f.button}
      </Button>
    </form>
  );
}

type Entry = { key: string; text: string; at: string; undo: Body; button: "Unhide" | "Unblock" };

function entries(m: AdminOverview["moderation"]): Entry[] {
  const hidden = m.hidden.map((h) => ({
    key: `h-${h.mint}`,
    text: `${h.symbol} hidden, ${h.reason}`,
    at: h.at,
    undo: { op: "unhide" as const, mint: h.mint },
    button: "Unhide" as const,
  }));
  const blocked = m.blocked.map((b) => ({
    key: `b-${b.wallet}`,
    text: `Deployer ${short(b.wallet)} blocked, ${b.reason}`,
    at: b.at,
    undo: { op: "unblock" as const, wallet: b.wallet },
    button: "Unblock" as const,
  }));
  return [...hidden, ...blocked].sort((a, b) => b.at.localeCompare(a.at));
}

function ModList({ overview, onChanged }: { overview: AdminOverview; onChanged(): void }) {
  const { onUnauthorized } = useAdmin();
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const list = entries(overview.moderation);
  async function undo(e: Entry) {
    setFailed(false);
    setSaving(e.key);
    const r = await moderate(e.undo);
    setSaving(null);
    if (r.status === 401) return onUnauthorized();
    // no_match means another tab already undid it: the reload shows the truth either way.
    if (!r.result) return setFailed(true);
    onChanged();
  }
  if (!list.length) return <p className="text-xs text-muted-foreground">Nothing hidden or blocked.</p>;
  return (
    <>
      <ul aria-label="Hidden coins and blocked deployers" className="text-xs">
        {list.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center gap-x-3 border-b border-line py-2">
            <span className="min-w-0 flex-1 break-words">{e.text}</span>
            <span className="text-muted-foreground" suppressHydrationWarning>{`${age(e.at)} ago`}</span>
            <button type="button" className={LINK} disabled={saving !== null} onClick={() => void undo(e)}>
              {saving === e.key ? "Saving…" : e.button}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {FAILED}
        </p>
      )}
    </>
  );
}

export function AdminModeration({ overview, onChanged }: { overview: AdminOverview; onChanged(): void }) {
  const [status, setStatus] = useState("");
  function done(op: FormSpec["op"], value: string) {
    const symbol = overview.rows.find((r) => r.mint === value)?.symbol;
    setStatus(moderationDone(op, op === "hide" ? (symbol ?? coinLabel(value)) : short(value)));
    onChanged(); // the list and the audit log show the change (D-21)
  }
  return (
    <Panel id="moderation-h" title="Moderation">
      <div className="grid gap-6">
        {FORMS.map((f) => (
          <ModForm key={f.op} f={f} done={done} />
        ))}
        <div>
          <p role="status" className="mb-2 text-xs text-muted-foreground empty:mb-0">
            {status}
          </p>
          <ModList overview={overview} onChanged={onChanged} />
        </div>
      </div>
    </Panel>
  );
}
