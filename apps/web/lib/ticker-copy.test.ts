// UI-SPEC A1 and A2: every ticker refusal line and the hour and minute boundaries (D-43, D-44).
import { expect, test } from "vitest";
import { reservedFieldError, tickerFault, tickerFieldError } from "./ticker-copy";

const landed = (retryAfter: number) => tickerFault("ticker_locked", "PEPE", { retryAfter, lock: "landed" });
const TAIL = ", or change the ticker in step 1. Nothing was sent.";

test("a landed lock names how long ago and how long to wait", () => {
  expect(landed(75600)).toBe(`$PEPE launched on BONDR 3h ago. Try again in 21h${TAIL}`);
  expect(landed(1500)).toBe(`$PEPE launched on BONDR 23h ago. Try again in 25 minutes${TAIL}`);
});

test("the wait rounds up: whole hours from 3600 s, minutes below with a minimum of 1", () => {
  const wait = (r: number) => landed(r).match(/Try again in ([^,]+),/)?.[1];
  expect([3600, 3599, 60, 59, 0].map(wait)).toEqual(["1h", "60 minutes", "1 minute", "1 minute", "1 minute"]);
  expect(landed(0)).toContain("launched on BONDR 24h ago.");
});

test("the age rounds down from 86400 - retryAfter", () => {
  const ago = (r: number) => landed(r).match(/on BONDR (.+) ago\./)?.[1];
  expect([82800, 82801, 86400].map(ago)).toEqual(["1h", "59 minutes", "less than a minute"]);
  expect(ago(86_340)).toBe("1 minute");
});

test("an in-flight lock and a missing retryAfter have their own lines", () => {
  expect(tickerFault("ticker_locked", "PEPE", { lock: "pending", retryAfter: 120 })).toBe(
    `Another launch of $PEPE is being signed on BONDR right now. Try again in a few minutes${TAIL}`,
  );
  expect(tickerFault("ticker_locked", "PEPE", { lock: "landed" })).toBe(
    `$PEPE launched on BONDR in the last 24 hours. Try again later${TAIL}`,
  );
});

test("a reserved ticker in step 4 and in the step 1 field", () => {
  expect(tickerFault("ticker_reserved", "SOL", {})).toBe(
    "$SOL is reserved on BONDR. Change the ticker in step 1. Nothing was sent.",
  );
  expect(reservedFieldError("SOL")).toBe("$SOL is reserved on BONDR. Choose another ticker.");
});

test("the step 1 field error is the first two sentences only", () => {
  expect(tickerFieldError("PEPE", { retryAfter: 75600, lock: "landed" })).toBe(
    "$PEPE launched on BONDR 3h ago. Try again in 21h.",
  );
  expect(tickerFieldError("PEPE", { lock: "pending" })).toBe(
    "Another launch of $PEPE is being signed on BONDR right now. Try again in a few minutes.",
  );
});
