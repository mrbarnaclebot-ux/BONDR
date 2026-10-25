// Owner intents (D-12): the worker writes the text the owner signs, keeps it, and checks the signature over
// those stored bytes at execute, so a leaked WORKER_TOKEN alone can never move funds.
// ponytail: per-process memory while the worker runs one replica (D-03). A restart drops pending intents,
// which then simply cannot be executed; move them to a shared store if the worker scales out.
import { randomBytes } from "node:crypto";
import type { AdminIntentView, AdminTxAction } from "@bondr/core/api-admin";
import { signatureOk } from "@bondr/core/sig";
import { fail } from "./http.ts";

export type Intent = {
  id: string;
  action: AdminTxAction;
  mint: string | null;
  message: string;
  expiresAt: number;
  used: boolean;
  state: "simulated" | AdminIntentView["state"];
  sigs: string[];
  landed: number;
  total: number;
  code?: string;
  moved?: number;
  failed?: number;
  data: unknown; // the simulation summary and the allowlist, for execute
  at: number; // last update, ms; retention after execute counts from here
};
type NewIntent = { action: AdminTxAction; mint: string | null; to: string[]; data: unknown };
type Patch = Partial<
  Pick<Intent, "state" | "sigs" | "landed" | "total" | "code" | "moved" | "failed" | "data">
>;

export const INTENT_TTL_MS = 120_000; // to execute after simulate
export const INTENT_KEEP_MS = 600_000; // after execute, for the browser's poll
export const INTENT_MAX = 200;
const intents = new Map<string, Intent>();

// Expiry binds only while unused; once taken, the entry lives on for the poll.
const live = (e: Intent, now: number) => (e.used ? now - e.at < INTENT_KEEP_MS : now < e.expiresAt);

// The first line differs from consent and admin sign-in, so neither signature can pass as an intent.
export const intentMessage = (i: {
  action: string;
  coin: string | null;
  id: string;
  to: string[];
  expiresAt: number;
}): string =>
  [
    "BONDR admin action",
    "",
    `Action: ${i.action}`,
    `Coin: ${i.coin ?? "platform"}`,
    `Intent: ${i.id}`,
    `Destinations: ${i.to.join(", ") || "burn only"}`,
    `Expires: ${new Date(i.expiresAt).toISOString()}`,
    "",
    "This is not a transaction. The BONDR worker checks it before sending.",
  ].join("\n");

// Sweep on insert, then drop the oldest while full (T-06-05-06).
export function putIntent(f: NewIntent, now = Date.now()): Intent {
  for (const [k, v] of intents) if (!live(v, now)) intents.delete(k);
  while (intents.size >= INTENT_MAX) intents.delete(intents.keys().next().value as string);
  const id = randomBytes(16).toString("hex");
  const expiresAt = now + INTENT_TTL_MS;
  const message = intentMessage({ action: f.action, coin: f.mint, id, to: f.to, expiresAt });
  const e: Intent = {
    id,
    action: f.action,
    mint: f.mint,
    message,
    expiresAt,
    used: false,
    state: "simulated",
    sigs: [],
    landed: 0,
    total: 0,
    data: f.data,
    at: now,
  };
  intents.set(id, e);
  return e;
}

// Synchronous on purpose: nothing yields between the check and `used = true`, so two concurrent executes cannot
// both pass. A bad signature leaves the intent usable, so a token holder cannot burn the owner's intent.
export function take(id: string, sig: Uint8Array, admin: string, now = Date.now()): Intent {
  const e = intents.get(id);
  if (!e || (!e.used && now >= e.expiresAt)) throw fail({ error: "intent_expired" });
  if (e.used) throw fail({ error: "intent_used" });
  if (!signatureOk(Buffer.from(e.message, "utf8"), sig, admin)) throw fail({ error: "bad_intent_signature" });
  e.used = true;
  e.state = "sending";
  e.at = now;
  return e;
}

function get(id: string, now: number): Intent | undefined {
  const e = intents.get(id);
  if (e && live(e, now)) return e;
  intents.delete(id);
  return undefined;
}

export function updateIntent(id: string, patch: Patch, now = Date.now()): Intent | undefined {
  const e = get(id, now);
  if (!e) return undefined;
  Object.assign(e, patch, { at: now });
  return e;
}

// What the browser polls after execute; null before execute too, since there is nothing sent to show.
export function viewIntent(id: string, now = Date.now()): AdminIntentView | null {
  const e = get(id, now);
  if (!e || e.state === "simulated") return null;
  const v: AdminIntentView = { id: e.id, state: e.state, sigs: e.sigs, landed: e.landed, total: e.total };
  if (e.code !== undefined) v.code = e.code;
  if (e.moved !== undefined) v.moved = e.moved;
  if (e.failed !== undefined) v.failed = e.failed;
  return v;
}
