// A throwaway indexed coin on the dev branch: wallet, vanity mint (negative idx, used_at set, so the pool never
// hands it out), landed launch, coins row and its trades. Names start with "E2E " so a person can tell them
// apart from real launches; created_at is a year back so the specs' "newest landed launch" never picks one.
import { randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const fakeMint = () => Array.from({ length: 44 }, () => B58[randomInt(58)]).join("");
const fakeSig = () => Array.from({ length: 88 }, () => B58[randomInt(58)]).join("");

export type Seeded = { mint: string; symbol: string; wallet: string; solIn: string; sigs: string[] };

/**
 * A coin with `trades` rows (at least 2): the launch transaction's buy and exit first, then buys and sells at
 * increasing slots up to now. `sigs` follows insert order, so the last one is the newest trade.
 */
export async function seedCoin(
  sql: postgres.Sql,
  { trades = 60, exit = "burn" }: { trades?: number; exit?: "burn" | "sell" } = {},
): Promise<Seeded> {
  const [mint, wallet, launchSig] = [fakeMint(), fakeMint(), fakeSig()];
  const symbol = `E${randomInt(100_000)}`;
  const solIn = "2500000";
  const id = randomBytes(16).toString("hex");
  const idx = -(2n ** 61n) - BigInt(randomInt(1_000_000_000));
  await sql`insert into wallets (address, consented_at, terms_version) values (${wallet}, now(), 'e2e')`;
  await sql`insert into vanity_mints (idx, pubkey, used_at) values (${idx.toString()}, ${mint}, now())`;
  await sql`insert into launches (id, wallet, mint, w, state, name, symbol, uri, sol_in, exit, signature, facts, created_at)
    values (${id}, ${wallet}, ${mint}, 'e2e', 'landed', ${`E2E ${symbol}`}, ${symbol}, 'https://ipfs.io/ipfs/x',
      ${solIn}, ${exit}, ${launchSig}, ${sql.json({ tokens: "31120363129478" })}, now() - interval '1 year')`;
  const start = Date.now() - trades * 60_000;
  await sql`insert into coins (mint, launch_id, launched_at, bonding_curve, pool, initial_real_token_reserves,
      real_token_reserves, real_quote_reserves, virtual_token_reserves, virtual_quote_reserves, mcap_sol, launch_mcap_sol)
    values (${mint}, ${id}, ${new Date(start)}, 'curve', 'pool', 793100000000000, 793100000000000, 0,
      1073000000000000, 30000000000, 28, 28)`;
  const rows = Array.from({ length: trades }, (_, i) => {
    const launch = i < 2;
    const side = launch ? (i === 0 ? "buy" : exit) : i % 3 ? "buy" : "sell";
    return {
      signature: launch ? launchSig : fakeSig(),
      ix: launch ? i : 0,
      mint,
      slot: String(1000 + (launch ? 0 : i)),
      at: new Date(start + (launch ? 0 : i) * 60_000),
      side,
      launch,
      venue: "curve",
      trader: launch ? wallet : fakeMint(),
      token_amount: String(31_120_363_129_478 + i),
      sol: side === "burn" ? null : String(launch ? solIn : 1_000_000 * (i + 1)),
      mcap_sol: 28 + i,
    };
  });
  await sql`insert into trades ${sql(rows)}`; // identity assigns seq in VALUES order (trades.test.ts checks it)
  return { mint, symbol, wallet, solIn, sigs: rows.map((r) => r.signature) };
}

/** Removes a seeded coin in reverse foreign-key order. */
export async function dropCoin(sql: postgres.Sql, mint: string): Promise<void> {
  await sql`delete from trades where mint = ${mint}`;
  await sql`delete from coins where mint = ${mint}`;
  const gone = await sql<{ wallet: string }[]>`delete from launches where mint = ${mint} returning wallet`;
  await sql`delete from vanity_mints where pubkey = ${mint}`;
  if (gone.length) await sql`delete from wallets where address in ${sql(gone.map((g) => g.wallet))}`;
}
