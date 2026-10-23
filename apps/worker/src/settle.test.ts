import { expect, test } from "vitest";
import { nextState, resumeAction } from "./settle.ts";
import { canRelease } from "./vanity.ts";

const at = { height: 100, lastValid: 150, rechecks: 0 };
const past = { ...at, height: 151 };

test("nextState: confirmed lands or fails, unseen polls until expiry, then rechecks, then expires", () => {
  expect(nextState({ ...at, seen: { confirmed: true, err: null } })).toEqual({ to: "landed" });
  const err = { InstructionError: [4, { Custom: 6003 }] };
  expect(nextState({ ...past, seen: { confirmed: true, err } })).toEqual({
    to: "failed",
    error: `onchain ${JSON.stringify(err)}`,
  });
  expect(nextState({ ...at, seen: null })).toEqual({ to: "poll" });
  expect(nextState({ ...at, height: 150, seen: null })).toEqual({ to: "poll" });
  expect(nextState({ ...at, seen: { confirmed: false, err: null } })).toEqual({ to: "poll" });
  expect(nextState({ ...past, seen: null })).toEqual({ to: "recheck" });
  expect(nextState({ ...past, rechecks: 2, seen: null })).toEqual({ to: "recheck" });
  expect(nextState({ ...past, rechecks: 3, seen: null })).toEqual({ to: "failed", error: "expired" });
  expect(nextState({ ...past, seen: null, rpcError: true })).toEqual({ to: "unknown" });
  expect(nextState({ ...at, seen: null, rpcError: true })).toEqual({ to: "poll" });
});

test("resumeAction never resends an unknown or an expired signed launch (D-16)", () => {
  expect(resumeAction("unknown", true)).toBe("check");
  expect(resumeAction("unknown", false)).toBe("check");
  expect(resumeAction("sent", true)).toBe("check");
  expect(resumeAction("signed", true)).toBe("resend");
  expect(resumeAction("signed", false)).toBe("check");
});

test("canRelease only for prepared and failed launches", () => {
  expect(canRelease("sent")).toBe(false);
  expect(canRelease("unknown")).toBe(false);
  expect(canRelease("signed")).toBe(false);
  expect(canRelease("landed")).toBe(false);
  expect(canRelease("failed")).toBe(true);
  expect(canRelease("prepared")).toBe(true);
});
