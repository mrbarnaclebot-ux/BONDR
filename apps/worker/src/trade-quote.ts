// POST /trade/quote and /trade/balance: the wallet-free route quote (D-10) from cached chain state, and one read
// of a wallet's SOL and coin balance. Web passes requests through, so everything is re-parsed here (T1).
import type { TradeBalance, TradeQuote, TradeSide } from "@bondr/core/api";
import type { Net } from "@bondr/core/keys";
import { BN, getBuyV3QuoteAmountFromTokenAmount } from "@bondr/core/pump";
import { routeQuote } from "@bondr/core/quote";
import { type Configs, hopInputs, type MintState } from "@bondr/core/quote-read";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  unpackAccount,
} from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";
import { fail } from "./http.ts";
import { knownCoins } from "./ingest.ts";
import { walletOf } from "./prepare.ts";
import { MAX_SOL_IN } from "./status.ts";
import { configs, mintState } from "./trade-state.ts";

export type TradeNet = Net | "mainnet";
type QuoteCtx = { conn: Connection; Q: PublicKey; net: TradeNet };
export type TradeReq = { side: TradeSide; mint: PublicKey; amount: bigint; slippageBps: number };

const U64 = 2n ** 64n;
// One signature plus the D-08 priority fee cap, in lamports.
const NETWORK_MAX = String(5_000 + 500_000);

// Registered coins only, which also bounds the quote cache (T6).
function knownMint(raw: unknown): PublicKey {
  if (typeof raw !== "string") throw fail({ error: "invalid_input" });
  if (!knownCoins.has(raw)) throw fail({ error: "not_found" });
  return new PublicKey(raw);
}

export function parseTrade(body: unknown, Q: PublicKey): TradeReq {
  const b = (body ?? {}) as Record<string, unknown>;
  const bad = fail({ error: "invalid_input" });
  const side = b.side === "buy" || b.side === "sell" ? b.side : null;
  if (!side || typeof b.amount !== "string" || !/^\d{1,20}$/.test(b.amount)) throw bad;
  const amount = BigInt(b.amount);
  if (amount < 1n || (side === "buy" ? amount > MAX_SOL_IN : amount >= U64)) throw bad;
  const s = b.slippageBps;
  if (typeof s !== "number" || !Number.isInteger(s) || s < 10 || s > 5_000) throw bad;
  if (b.mint === Q.toBase58()) throw bad; // BONDR itself is not a route end
  return { side, mint: knownMint(b.mint), amount, slippageBps: s };
}

type Curve = Extract<MintState, { venue: "curve" }>;

// The quote a curve charges for `amount` of its base, fees included.
const curveCost = (c: Configs, s: Curve, amount: BN): BN =>
  getBuyV3QuoteAmountFromTokenAmount({
    global: c.global,
    feeConfig: c.feeConfig,
    mintSupply: s.curve.tokenTotalSupply,
    bondingCurve: s.curve,
    amount,
    curveBaseTokenBalance: s.curveTokenBalance,
  });

// ponytail: devnet-only guard keyed on net so a friend's 1 SOL buy cannot bond BONDR's shared devnet curve
// (Pitfall 4), nor the coin's own curve, which devnet can never migrate (S-WR-04). Both keep a 10% margin and
// the smaller wins; the coin's is its BONDR cost to complete, priced on BONDR's curve (each hop's fees count,
// so it errs high). Mainnet uncapped (Phase 7 confirms); a devnet BONDR on its pool is uncapped too.
export function maxSolIn(net: TradeNet, bondr: MintState, coin: MintState, c: Configs): string | undefined {
  if (net !== "devnet" || bondr.venue !== "curve") return undefined;
  const full = curveCost(c, bondr, bondr.curve.realTokenReserves);
  const coinFull =
    coin.venue === "curve" ? curveCost(c, bondr, curveCost(c, coin, coin.curve.realTokenReserves)) : full;
  return BN.min(full, coinFull).muln(9).divn(10).toString();
}

export async function quoteTrade(ctx: QuoteCtx, body: unknown): Promise<TradeQuote> {
  const req = parseTrade(body, ctx.Q);
  const [cfg, bondr, coin] = await Promise.all([
    configs(ctx),
    mintState(ctx, ctx.Q, NATIVE_MINT),
    mintState(ctx, req.mint, ctx.Q),
  ]);
  if (bondr.venue === "awaiting" || coin.venue === "awaiting")
    throw fail({ error: "paused", paused: "awaiting_migration" });
  const q = routeQuote({
    side: req.side,
    bondrMint: ctx.Q,
    coinMint: req.mint,
    bondr: hopInputs(bondr, cfg),
    coin: hopInputs(coin, cfg),
    amountIn: req.amount,
    slippageBps: req.slippageBps,
    ammGlobalConfig: cfg.ammGlobalConfig,
    ammFeeConfig: cfg.ammFeeConfig,
  });
  const max = maxSolIn(ctx.net, bondr, coin, cfg);
  return { ...q, fees: { ...q.fees, networkMax: NETWORK_MAX }, ...(max && { maxSolIn: max }) };
}

// The wallet comes from web's session (T2), never from the browser.
export async function tradeBalance(ctx: { conn: Connection }, body: unknown): Promise<TradeBalance> {
  const b = (body ?? {}) as Record<string, unknown>;
  const wallet = walletOf(b.wallet);
  if (!wallet) throw fail({ error: "invalid_input" });
  const owner = new PublicKey(wallet);
  const mint = knownMint(b.mint);
  const ata = getAssociatedTokenAddressSync(mint, owner, true, T22);
  const [w, a] = await ctx.conn.getMultipleAccountsInfo([owner, ata]);
  const tokens = a ? unpackAccount(ata, a, T22).amount : 0n;
  return { sol: String(w?.lamports ?? 0), tokens: String(tokens) };
}
