import { describe, expect, test } from "vitest";
import { moderationDone, moderationError } from "./admin-copy-mod";

const MINT = "BNDRxQ7yW3kC9vV1sLp2mN4tR8hJ6dF5gA0eZcUo1bndr";

describe("moderationError", () => {
  test.each([
    [{ reason: "no_match" }, "zzzzzz", "query", "No BONDR coin matches zzzzzz."],
    [{ reason: "ambiguous", count: 3 }, "swmp", "query", "3 coins use SWMP. Paste the mint instead."],
    [{ reason: "already_hidden" }, "swmp", "query", "SWMP is already hidden."],
    [{ reason: "invalid_wallet" }, "x", "wallet", "Enter a valid Solana wallet address."],
    [{ reason: "already_blocked" }, "x", "wallet", "That wallet is already blocked."],
    [{ reason: "no_reason" }, "swmp", "reason", "Add a reason."],
  ] as const)("%o", (r, query, field, text) => {
    expect(moderationError({ ok: false, ...r }, query)).toEqual({ field, text });
  });

  test("a mint query reads short, never upper-cased", () => {
    expect(moderationError({ ok: false, reason: "already_hidden" }, MINT).text).toBe(
      "BNDR…bndr is already hidden.",
    );
  });
});

test("moderationDone", () => {
  expect(moderationDone("hide", "SWMP")).toBe("SWMP is hidden from lists. Its page stays reachable by link.");
  expect(moderationDone("block", "7xKX…AsU")).toBe("7xKX…AsU can no longer launch on BONDR.");
});
