import { describe, expect, test } from "vitest";
import { derive, type Net } from "./keys.ts";

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

  test("a different master gives a different key", () => {
    const other = Buffer.alloc(32, 7);
    expect(pk(other, "w", "devnet", "X")).not.toBe(pk(master, "w", "devnet", "X"));
  });
});
