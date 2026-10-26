// UI-SPEC Moderation copy (ADMIN-07, D-29, D-30). Pure, so the unit test pins every refusal's line and field.
import type { ModerationResult } from "@bondr/core/api-admin";
import { short } from "./format";

type Refusal = Exclude<ModerationResult, { ok: true }>;
export type ModField = "query" | "wallet" | "reason";

// A symbol is at most 13 characters and a mint at least 32, so length tells them apart.
export const coinLabel = (query: string): string => (query.length >= 32 ? short(query) : query.toUpperCase());

/** The FieldError line for a refusal and the field it sits under. */
export function moderationError(r: Refusal, query: string): { field: ModField; text: string } {
  const q = query.trim();
  switch (r.reason) {
    case "no_match":
      return { field: "query", text: `No BONDR coin matches ${q}.` };
    case "ambiguous":
      return {
        field: "query",
        text: `${r.count ?? "Several"} coins use ${coinLabel(q)}. Paste the mint instead.`,
      };
    case "already_hidden":
      return { field: "query", text: `${coinLabel(q)} is already hidden.` };
    case "invalid_wallet":
      return { field: "wallet", text: "Enter a valid Solana wallet address." };
    case "already_blocked":
      return { field: "wallet", text: "That wallet is already blocked." };
    case "no_reason":
      return { field: "reason", text: "Add a reason." };
  }
}

/** The polite status line after a hide or a block lands. */
export const moderationDone = (op: "hide" | "block", label: string): string =>
  op === "hide"
    ? `${label} is hidden from lists. Its page stays reachable by link.`
    : `${label} can no longer launch on BONDR.`;
