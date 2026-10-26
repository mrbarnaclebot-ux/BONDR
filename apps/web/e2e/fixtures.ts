// A throwaway indexed coin on the dev branch: wallet, vanity mint (negative idx, used_at set, so the pool never
// hands it out), landed launch, coins row and its trades. Names start with "E2E " so a person can tell them
// apart from real launches; created_at is a year back so the specs' "newest landed launch" never picks one.
import { randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const fakeMint = () => Array.from({ length: 44 }, () => B58[randomInt(58)]).join("");
export const fakeSig = () => Array.from({ length: 88 }, () => B58[randomInt(58)]).join("");

export type Seeded = { mint: string; symbol: string; wallet: string; solIn: string; sigs: string[] };

// A fresh curve: the coins columns every seeded coin starts from.
const CURVE = {
  bonding_curve: "curve",
  pool: "pool",
  initial_real_token_reserves: "793100000000000",
  real_token_reserves: "793100000000000",
  real_quote_reserves: "0",
  virtual_token_reserves: "1073000000000000",
  virtual_quote_reserves: "30000000000",
  mcap_sol: 28,
  launch_mcap_sol: 28,
};

/** The seeded trade rows: the launch transaction's buy and exit, then buys and sells a minute apart. */
function tradeRows(
  s: { mint: string; wallet: string; launchSig: string; solIn: string },
  n: number,
  exit: string,
) {
  const start = Date.now() - n * 60_000;
  return Array.from({ length: n }, (_, i) => {
    const launch = i < 2;
    const side = launch ? (i === 0 ? "buy" : exit) : i % 3 ? "buy" : "sell";
    return {
      signature: launch ? s.launchSig : fakeSig(),
      ix: launch ? i : 0,
      mint: s.mint,
      slot: String(1000 + (launch ? 0 : i)),
      at: new Date(start + (launch ? 0 : i) * 60_000),
      side,
      launch,
      venue: "curve",
      trader: launch ? s.wallet : fakeMint(),
      token_amount: String(31_120_363_129_478 + i),
      sol: side === "burn" ? null : String(launch ? s.solIn : 1_000_000 * (i + 1)),
      mcap_sol: 28 + i,
    };
  });
}

/**
 * A coin with `trades` rows (0, or at least 2): the launch transaction's buy and exit first, then buys and sells
 * at increasing slots up to now. `sigs` follows insert order, so the last one is the newest trade. `coin`
 * overrides coins columns by their SQL names (venue, holders, bond_sig, ...).
 */
export async function seedCoin(
  sql: postgres.Sql,
  {
    trades = 60,
    exit = "burn",
    coin = {},
  }: { trades?: number; exit?: "burn" | "sell"; coin?: Record<string, string | number | Date | null> } = {},
): Promise<Seeded> {
  const [mint, wallet, launchSig] = [fakeMint(), fakeMint(), fakeSig()];
  // Fixed width, so one seeded symbol is never a substring of another's "E2E {symbol}" card name.
  const symbol = `E${String(randomInt(100_000)).padStart(5, "0")}`;
  const solIn = "2500000";
  const id = randomBytes(16).toString("hex");
  const idx = -(2n ** 61n) - BigInt(randomInt(1_000_000_000));
  await sql`insert into wallets (address, consented_at, terms_version) values (${wallet}, now(), 'e2e')`;
  await sql`insert into vanity_mints (idx, pubkey, used_at) values (${idx.toString()}, ${mint}, now())`;
  await sql`insert into launches (id, wallet, mint, w, state, name, symbol, uri, sol_in, exit, signature, facts, created_at)
    values (${id}, ${wallet}, ${mint}, 'e2e', 'landed', ${`E2E ${symbol}`}, ${symbol}, 'https://ipfs.io/ipfs/x',
      ${solIn}, ${exit}, ${launchSig}, ${sql.json({ tokens: "31120363129478" })}, now() - interval '1 year')`;
  const row = { ...CURVE, mint, launch_id: id, launched_at: new Date(Date.now() - trades * 60_000), ...coin };
  await sql`insert into coins ${sql(row)}`;
  const rows = tradeRows({ mint, wallet, launchSig, solIn }, trades, exit);
  if (rows.length) await sql`insert into trades ${sql(rows)}`; // identity assigns seq in VALUES order (trades.test.ts checks it)
  return { mint, symbol, wallet, solIn, sigs: rows.map((r) => r.signature) };
}

export type LedgerSeed = {
  kind: string;
  state?: "pending" | "landed" | "failed" | "expired" | null;
  amount?: string;
  burned?: string;
  sol?: string;
  signature?: string | null; // default fakeSig(); null for held rows
  window_index?: number;
  ref?: number;
  detail?: Record<string, unknown>;
  landed_at?: Date; // landed rows only, default now
};

/** fee_ledger rows on a seeded coin (state defaults to landed). Returns each row's id and signature. */
export async function seedLedger(
  sql: postgres.Sql,
  mint: string,
  rows: LedgerSeed[],
): Promise<{ id: string; signature: string | null }[]> {
  const values = rows.map(({ landed_at, detail, ...r }) => {
    const state = r.state === undefined ? "landed" : r.state;
    const signature = r.signature === undefined ? fakeSig() : r.signature;
    return {
      amount: null,
      burned: null,
      sol: null,
      window_index: null,
      ref: null,
      ...r,
      mint,
      state,
      signature,
      detail: detail ? sql.json(detail as postgres.JSONValue) : null,
      landed_at: state === "landed" ? (landed_at ?? new Date()) : null,
      last_valid_block_height: signature ? "1000" : null,
    };
  });
  return sql<{ id: string; signature: string | null }[]>`insert into fee_ledger ${sql(values)}
    returning id, signature`;
}

/** Removes a seeded coin in reverse foreign-key order. */
export async function dropCoin(sql: postgres.Sql, mint: string): Promise<void> {
  await sql`delete from fee_ledger where mint = ${mint}`;
  await sql`delete from trades where mint = ${mint}`;
  await sql`delete from coins where mint = ${mint}`;
  const gone = await sql<{ wallet: string }[]>`delete from launches where mint = ${mint} returning wallet`;
  await sql`delete from vanity_mints where pubkey = ${mint}`;
  if (gone.length) await sql`delete from wallets where address in ${sql(gone.map((g) => g.wallet))}`;
}

// The public devnet RPC, so the e2e process needs no Helius key; blockTime has 1 s resolution.
export async function blockTime(signature: string): Promise<number> {
  for (let i = 0; i < 15; i++) {
    const res = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }],
      }),
    }).then((r) => r.json() as Promise<{ result?: { blockTime?: number } | null }>);
    if (res.result?.blockTime) return res.result.blockTime;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`no blockTime for ${signature}`);
}
