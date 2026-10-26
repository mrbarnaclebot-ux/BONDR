import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { derive, type Net, readSeed } from "./keys.ts";

const master = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const pk = (m: Buffer, role: Parameters<typeof derive>[1], net: Net, id: string) =>
  derive(m, role, net, id).publicKey.toBase58();

describe("derive", () => {
  test("is deterministic", () => {
    expect(pk(master, "w", "devnet", "X")).toBe(pk(master, "w", "devnet", "X"));
  });

  test("role, net and id each change the key", () => {
    const base = pk(master, "w", "devnet", "X");
    expect(pk(master, "ops", "devnet", "X")).not.toBe(base);
    expect(pk(master, "w", "fork", "X")).not.toBe(base);
    expect(pk(master, "w", "devnet", "Y")).not.toBe(base);
  });

  test("mainnet ids never equal devnet or fork ids under one seed (D-01 row 3)", () => {
    const main = pk(master, "ops", "mainnet", "main");
    expect(main).not.toBe(pk(master, "ops", "devnet", "main"));
    expect(main).not.toBe(pk(master, "ops", "fork", "main"));
  });

  test("mint keys are disjoint per lane and from wallet keys (D-20)", () => {
    const local = pk(master, "mint", "devnet", "local.7");
    expect(local).not.toBe(pk(master, "mint", "devnet", "staging.7"));
    expect(local).not.toBe(pk(master, "w", "devnet", "local.7"));
  });

  test("the buyback key is its own role", () => {
    const buyback = pk(master, "buyback", "devnet", "local");
    expect(buyback).not.toBe(pk(master, "treasury", "devnet", "local"));
    expect(buyback).not.toBe(pk(master, "ops", "devnet", "local"));
  });

  test("a different master gives a different key", () => {
    const other = Buffer.alloc(32, 7);
    expect(pk(other, "w", "devnet", "X")).not.toBe(pk(master, "w", "devnet", "X"));
  });
});

test("readSeed refuses a shared or wrong-length seed file", () => {
  const file = join(mkdtempSync(join(tmpdir(), "seed-")), "master.seed");
  writeFileSync(file, Buffer.alloc(32, 1), { mode: 0o600 });
  expect(readSeed(file).length).toBe(32);
  chmodSync(file, 0o640);
  expect(() => readSeed(file)).toThrow("readable by others");
  writeFileSync(file, Buffer.alloc(31));
  chmodSync(file, 0o600);
  expect(() => readSeed(file)).toThrow("not a 32-byte seed");
});
