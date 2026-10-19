import { expect, test } from "vitest";
import { compact, explorer, pct, short, sol } from "./format";

test("sol trims trailing zeros and rounds to the given places", () => {
  expect(sol(2_500_000n)).toBe("0.0025");
  expect(sol("500000000")).toBe("0.5");
  expect(sol(2_000_000_000n)).toBe("2");
  expect(sol(2_377_323n, 3)).toBe("0.002");
  expect(sol(11_917_680n, 4)).toBe("0.0119");
});

test("sol rounds costs up so a real fee never reads 0", () => {
  expect(sol(10_600n, 4)).toBe("0");
  expect(sol(10_600n, 4, true)).toBe("0.0001");
  expect(sol(11_917_680n, 4, true)).toBe("0.012");
});

test("pct has a receipt form and a prose form", () => {
  expect(pct(150)).toBe("1.50%");
  expect(pct(150, true)).toBe("1.5%");
  expect(pct(95)).toBe("0.95%");
  expect(pct(30, true)).toBe("0.3%");
  expect(pct(0)).toBe("0.00%");
});

test("compact, short and explorer", () => {
  expect(compact("31120363129478")).toBe("31.1M");
  expect(short("4xEfLsmWx8o89XA9iWtf2T5KESn3hLjT4sLK7kBJbndr")).toBe("4xEf…bndr");
  expect(explorer("tx", "sig", "devnet")).toBe("https://solscan.io/tx/sig?cluster=devnet");
  expect(explorer("token", "m", "mainnet")).toBe("https://solscan.io/token/m");
});
