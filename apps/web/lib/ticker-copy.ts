// UI-SPEC A1 and A2: the ticker cooldown and reserved-ticker refusals (D-43, D-44). Pure, so the copy is tested
// line by line. The wait rounds up and the age rounds down, so the two always add up to the 24h window.
import type { ApiError } from "@bondr/core/api";

type Refusal = Pick<ApiError, "retryAfter" | "lock">;
const DAY_S = 86_400;
const HOUR_S = 3_600;
const TAIL = ", or change the ticker in step 1. Nothing was sent.";

const minutes = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);

function wait(s: number): string {
  return s >= HOUR_S ? `${Math.ceil(s / HOUR_S)}h` : minutes(Math.max(1, Math.ceil(s / 60)));
}

function ago(retryAfter: number): string {
  const e = Math.max(0, DAY_S - retryAfter);
  if (e >= HOUR_S) return `${Math.floor(e / HOUR_S)}h`;
  const m = Math.floor(e / 60);
  return m === 0 ? "less than a minute" : minutes(m);
}

// The lead sentence and the "Try again ..." clause; step 4 and the step 1 field end them differently.
function locked(symbol: string, r: Refusal): [string, string] {
  const t = `$${symbol}`;
  if (r.lock === "pending")
    return [`Another launch of ${t} is being signed on BONDR right now`, "Try again in a few minutes"];
  if (r.retryAfter === undefined) return [`${t} launched on BONDR in the last 24 hours`, "Try again later"];
  return [`${t} launched on BONDR ${ago(r.retryAfter)} ago`, `Try again in ${wait(r.retryAfter)}`];
}

/** The step 4 error line for a ticker refusal. */
export function tickerFault(code: "ticker_locked" | "ticker_reserved", symbol: string, r: Refusal): string {
  if (code === "ticker_reserved")
    return `$${symbol} is reserved on BONDR. Change the ticker in step 1. Nothing was sent.`;
  const [lead, retry] = locked(symbol, r);
  return `${lead}. ${retry}${TAIL}`;
}

/** The step 1 symbol field after a ticker_locked refusal: the first two sentences only. */
export function tickerFieldError(symbol: string, r: Refusal): string {
  const [lead, retry] = locked(symbol, r);
  return `${lead}. ${retry}.`;
}

export const reservedFieldError = (symbol: string): string =>
  `$${symbol} is reserved on BONDR. Choose another ticker.`;
