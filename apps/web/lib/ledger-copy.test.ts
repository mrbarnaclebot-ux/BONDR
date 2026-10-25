import type { LedgerRow } from "@bondr/core/api";
import { PUBLIC_KINDS } from "@bondr/core/fees";
import { expect, test } from "vitest";
import { COPY, known, launchCopy, ledgerCopy } from "./ledger-copy";

const row = (r: Partial<LedgerRow>): LedgerRow => ({
  id: "1",
  kind: "collect",
  amount: null,
  burned: null,
  sol: null,
  signature: "sig",
  windowIndex: null,
  detail: null,
  landedAt: "2026-10-18T21:14:09.000Z",
  ...r,
});

test("every public kind has copy, and no internal kind does", () => {
  expect(Object.keys(COPY).sort()).toEqual([...PUBLIC_KINDS].sort());
  for (const k of ["held", "buyback_burn", "reconcile_diff"]) expect(Object.hasOwn(COPY, k)).toBe(false);
});

test("known drops a kind this build has no copy for", () => {
  const rows = [
    row({ kind: "collect" }),
    { ...row({}), kind: "future_kind" },
    { ...row({}), kind: "toString" },
  ];
  expect(rows.filter(known).map((r) => r.kind)).toEqual(["collect"]);
});

test("split_treasury reads BONDR in whole units and its SOL value", () => {
  const c = ledgerCopy(row({ kind: "split_treasury", amount: "1234567", sol: "420000000" }), "GRUB");
  expect(c.tag).toBe("Split 90/10");
  expect(c.tone).toBe("mint");
  expect(c.text).toBe(
    "Sent 1 BONDR, the 10% share, to treasury. The other 90% stays in the fee wallet as burn budget.",
  );
  expect(c.value).toBe("0.42 SOL");
});

test("sweep names the window number, counted from 1", () => {
  const c = ledgerCopy(row({ kind: "sweep_buyback", amount: "810000000", windowIndex: 0 }), "GRUB");
  expect(c.tone).toBe("warn");
  expect(c.text).toContain("Window 1 closed unbonded. Swept 810 BONDR");
});

test("finalize_update shows its shares, finalize_config drops the sweep clause without an amount", () => {
  const u = ledgerCopy(row({ kind: "finalize_update", detail: { dBps: 8000, tBps: 2000 } }), "GRUB");
  expect(u.value).toBe("8000 / 2000 bps");
  const c = ledgerCopy(row({ kind: "finalize_config" }), "GRUB");
  expect(c.text).toBe("Set up fee sharing for GRUB with the deployer and treasury as recipients.");
  expect(c.value).toBeNull();
  const s = ledgerCopy(row({ kind: "finalize_config", amount: "5000000", sol: "1000" }), "GRUB");
  expect(s.text).toContain(", after sweeping pending fees.");
  expect(s.value).toBe("<0.001 SOL");
});

test("forced bond is a leaf burn tag with the burned tokens", () => {
  const c = ledgerCopy(row({ kind: "forced_bond", amount: "2000000000", burned: "31120363129478" }), "GRUB");
  expect([c.tag, c.tone]).toEqual(["Forced bond", "leaf"]);
  expect(c.text.startsWith("Burned 31.1M GRUB.")).toBe(true);
});

test("leftover burn is a leaf tag with the burned tokens and an optional SOL value", () => {
  const c = ledgerCopy(row({ kind: "leftover_burn", burned: "31120363129478" }), "GRUB");
  expect([c.tag, c.tone, c.value]).toEqual(["Leftover burn", "leaf", null]);
  expect(c.text).toBe("Burned leftover 31.1M GRUB from the fee wallet.");
  expect(ledgerCopy(row({ kind: "leftover_burn", burned: "1", sol: "420000000" }), "GRUB").value).toBe(
    "0.42 SOL",
  );
});

test("evacuate is a warn Emergency row naming the treasury, BONDR or SOL only", () => {
  const b = ledgerCopy(row({ kind: "evacuate", amount: "810000000", sol: "420000000" }), "GRUB");
  expect([b.tag, b.tone, b.value]).toEqual(["Emergency", "warn", "0.42 SOL"]);
  expect(b.text).toBe(
    "Moved 810 BONDR to treasury, emergency. BONDR paused its fee jobs and moved every fee wallet balance to treasury.",
  );
  const s = ledgerCopy(row({ kind: "evacuate", sol: "420000000" }), "GRUB");
  expect(s.text).toBe("Moved 0.42 SOL to treasury, emergency.");
  expect(s.value).toBe("0.42 SOL");
});

test("launch row reads burn or sell", () => {
  const b = launchCopy({ exit: "burn", solIn: "500000000", tokens: "31120363129478", symbol: "GRUB" });
  expect([b.tag, b.tone, b.value]).toEqual(["Launch burn", "leaf", "0.5 SOL"]);
  expect(b.text).toBe("Dev buy of 0.5 SOL (31.1M GRUB) burned in the launch transaction (insta burn).");
  const s = launchCopy({ exit: "sell", solIn: "500000000", symbol: "GRUB" });
  expect([s.tag, s.tone]).toEqual(["Launch sell", "plain"]);
  expect(s.text).toContain("sold back in the launch transaction (insta sell)");
});
