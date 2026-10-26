// The send-side pieces every money action shares (D-12, D-14, D-33): the gated deps whose land re-checks each
// tx's destinations, the browser-safe error code, the intent progress and the one outcome the audit settles to.
// Split from admin-money.ts so EVACUATE (admin-evacuate.ts) uses the same rules without an import cycle.
import type { AdminIntentView } from "@bondr/core/api-admin";
import { redact } from "@bondr/core/net";
import { tradeError } from "@bondr/core/trade-error";
import type { Final } from "./admin-audit.ts";
import { type Allowed, refusedDestination } from "./admin-dest.ts";
import type { FeeDeps, Landed } from "./fee-send.ts";

export type Out = { state: AdminIntentView["state"]; result: Final; error?: string };

// D-14, D-16: admin runs ignore switches and holds, but every tx is checked against the allowlist right before
// it is sent. A refusal answers skipped, which settled() reads as a stop, so later steps never build.
export function gatedDeps(base: FeeDeps, allowed: Allowed, onRefused: (to: string) => void): FeeDeps {
  return {
    ...base,
    allowed: () => true,
    land: async (job) => {
      const to = refusedDestination(job.ixs, allowed);
      if (!to) return base.land(job);
      onRefused(to);
      return { state: "skipped" };
    },
  };
}

// Only a contract code reaches the browser, never the RPC's own text.
export function codeOf(err: string): string {
  if (err === "ops_low") return err; // captureDeps' own code, already browser-safe
  try {
    return tradeError(JSON.parse(err), null).error;
  } catch {
    return "simulation_failed";
  }
}

export const logged = (action: string) => (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  console.error(`admin ${action} failed: ${redact(text)}`);
};

export const progress = (seen: Landed[]) => ({
  sigs: seen.flatMap((l) => (l.sig ? [l.sig] : [])),
  landed: seen.filter((l) => l.state === "landed").length,
  total: seen.length,
});

// Refused first: the lock fired. Then unknown, never resent: the owner refreshes once the chain answers.
export function outcome(seen: Landed[], refused: string | null, threw: boolean): Out {
  if (refused) return { state: "refused", result: "refused", error: "destination_refused" };
  if (seen.some((l) => l.state === "unknown"))
    return { state: "unknown", result: "failed", error: "unconfirmed" };
  const bad = seen.find((l) => l.state !== "landed" && l.state !== "done");
  if (bad) {
    const why =
      bad.state === "skipped" ? "ops_low" : bad.code === undefined ? "send_failed" : `code ${bad.code}`;
    return { state: "failed", result: "failed", error: why };
  }
  if (threw) return { state: "failed", result: "failed", error: "build_failed" };
  if (!seen.length) return { state: "failed", result: "failed", error: "nothing_sent" };
  return { state: "landed", result: "landed" };
}
