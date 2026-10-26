// The web/worker contract. Types only, no imports and no runtime code, so web may import it (D-15).
// Every amount is a decimal string of lamports or token base units: bigint survives JSON that way.

export type Net = "devnet" | "mainnet";
export type PauseReason = "kill_switch" | "awaiting_migration";
export type Exit = "burn" | "sell";

export type Status = {
  net: Net;
  paused: PauseReason | null;
  quoteMint: string;
  // null when the live config could not be read; the UI then shows "Unavailable" and disables signing.
  fees: { protocolBps: number; creatorBps: number } | null;
  minLamports: string | null;
  createCostEstimate: string | null;
  networkFeeEstimate: string | null;
};

export type QuoteRequest = { solIn: string; wallet?: string };
export type Quote = { tokensOut: string; solBackEstimate: string; balance?: string };

export type LaunchErrorCode =
  | "paused"
  | "consent_required"
  | "invalid_input"
  | "pool_empty"
  | "rate_limited"
  | "insufficient_balance"
  | "build_failed"
  | "expired"
  | "cosign_refused"
  | "not_found"
  | "worker_unavailable"
  | "pin_failed"
  | "slippage"
  | "message_changed"
  | "onchain"
  // Phase 6 admin and moderation (statuses in apps/worker/src/http.ts).
  | "forbidden"
  | "blocked"
  | "intent_expired"
  | "intent_used"
  | "bad_intent_signature"
  | "not_applicable"
  | "simulation_failed"
  | "destination_refused"
  | "rpc_failed";

// reason: the admin not_applicable code the console maps to copy (D-12).
export type ApiError = { error: LaunchErrorCode; paused?: PauseReason; reason?: string };

export type Links = { x?: string; telegram?: string; website?: string };

export type PrepareRequest = {
  wallet: string;
  name: string;
  symbol: string;
  description?: string;
  links: Links;
  uri: string;
  imageCid: string;
  solIn: string;
  exit: Exit;
};

export type PrepareResult = {
  launchId: string;
  // base64 wire with two empty signature slots: the dev's (Phantom) and the mint's (worker, at submit).
  tx: string;
  mint: string;
  bytes: number;
  // Seconds the dev has to sign before the blockhash expires.
  signBy: number;
  preview: { createCost: string; networkFee: string; solBack: string | null; tokensOut: string };
};

export type LaunchState = "prepared" | "signed" | "sent" | "landed" | "failed" | "unknown";

export type SubmitRequest = { launchId: string; signed: string };
export type SubmitResult = { state: LaunchState; signature?: string };

export type LaunchView = {
  id: string;
  state: LaunchState;
  mint: string;
  name: string;
  symbol: string;
  exit: Exit;
  solIn: string;
  signature: string | null;
  error: LaunchErrorCode | string | null;
  facts: { tokens?: string; solBack?: string; devChildAfter?: string } | null;
  imageCid: string | null;
  links: Links;
  wallet: string;
  createdAt: string;
};

// Lists, token page and live updates (Phase 3). Market caps and SOL values are numbers (display only).
export type Venue = "curve" | "complete" | "pool";

// The fields a trade can change: what the live stream carries for a coin.
export type CoinLive = {
  mint: string;
  venue: Venue;
  mcapSol: number;
  progress: number;
  vol1h: number;
  vol24h: number;
  change1h: number | null;
  lastTradeAt: string | null;
  bondSol: number | null;
  bondrAtBond: string | null;
  realQuoteReserves: string;
  holders: number | null;
  fees?: CoinFees;
};

// Fee engine (Phase 5). Every money field is base units or lamports as a decimal string; web formats only.
export type LedgerKind =
  | "collect"
  | "split_treasury"
  | "sweep_buyback"
  | "sweep_treasury"
  | "forced_bond"
  | "pool_burn"
  | "buyback_burn"
  | "finalize_config"
  | "finalize_update"
  | "distribute"
  | "leftover_burn"
  | "evacuate"
  | "held"
  | "reconcile_diff";
// The platform burn and the internal rows never reach a public read.
export type PublicKind = Exclude<LedgerKind, "buyback_burn" | "held" | "reconcile_diff">;
export type LedgerState = "pending" | "landed" | "failed" | "expired";

export type LedgerRow = {
  id: string;
  kind: PublicKind;
  amount: string | null;
  burned: string | null;
  sol: string | null; // lamports
  signature: string;
  windowIndex: number | null;
  detail: {
    dBps?: number;
    tBps?: number;
    deployer?: string;
    treasury?: string;
    deployerAmount?: string;
    treasuryAmount?: string;
  } | null;
  landedAt: string;
};

export type CoinFees = {
  w: string | null;
  budget: string;
  budgetSol: string | null;
  cost: string | null;
  costSol: string | null;
  toBuyback: string;
  toBuybackSol: string;
  toTreasury: string;
  toTreasurySol: string;
  bondSpent: string;
  bondSpentSol: string;
  bondBurned: string;
  burnedSupply: string;
  bondKind: "forced" | "fallback" | null;
  bondBurnSig: string | null;
  deployerEarned: string;
  deployerEarnedSol: string;
  finalize: "none" | "held" | "done";
  deployerBps: number | null;
  finalizeSig: string | null;
};

export type CoinRow = CoinLive & {
  name: string;
  symbol: string;
  imageCid: string | null;
  exit: Exit;
  launchedAt: string;
  launchMcapSol: number;
  bondSig: string | null;
  bondedAt: string | null;
  createSlot: string | null; // null before 07-07: no sniped figure is shown
  snipedBps: number | null;
};

export type TradeRow = {
  signature: string;
  ix: number;
  side: "buy" | "sell" | "burn";
  launch: boolean;
  venue: "curve" | "pool";
  trader: string;
  tokenAmount: string;
  sol: string | null;
  mcapSol: number | null;
  at: string;
  slot: string;
  seq: string;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type LiveEvent = { id: string } & (
  | { type: "trade"; data: { trade: TradeRow & { mint: string }; coin: CoinLive } }
  | { type: "launch"; data: CoinRow }
  | { type: "bond"; data: { mint: string; venue: Venue; bondSig: string | null; bondedAt: string | null } }
  | { type: "holders"; data: { mint: string; holders: number } }
  | { type: "fee"; data: { mint: string | null; rows: LedgerRow[]; coin: CoinLive | null } }
);

// Trading (Phase 4). One error vocabulary for launches and trades.
export type TradeErrorCode = LaunchErrorCode;
export type TradeSide = "buy" | "sell";
export type HopVenue = "curve" | "pool";

// amount: lamports for a buy, coin base units for a sell. No wallet: quotes are public (D-10).
export type TradeQuoteRequest = { side: TradeSide; mint: string; amount: string; slippageBps: number };

// The masked rates one hop of the route charges and their value in lamports (RESEARCH Pattern 2).
export type HopFee = { venue: HopVenue; protocolBps: number; creatorBps: number; lpBps: number; sol: string };

export type TradeQuote = {
  side: TradeSide;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  // 1 - out / spot out, a fraction. Display only: it never feeds an amount.
  impact: number;
  route: { bondr: HopVenue; coin: HopVenue };
  fees: { bondrHop: HopFee; coinHop: HopFee; platformFee: "0"; totalSol: string; networkMax: string };
  // Devnet only, while BONDR is on its curve: larger buys would bond it (RESEARCH Pitfall 4).
  maxSolIn?: string;
};

export type TradeBalance = { sol: string; tokens: string };

export type TradePrepareResult = {
  tradeId: string;
  // base64 wire with one empty signature slot, the trader's.
  tx: string;
  signBy: number; // seconds
  expectedOut: string;
  minAmountOut: string;
};

export type TradeSubmitRequest = { tradeId: string; signed: string };
export type TradeView = { state: LaunchState; signature?: string; amountOut?: string; code?: TradeErrorCode };
