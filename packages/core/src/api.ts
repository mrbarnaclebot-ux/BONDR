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
  | "pin_failed";

export type ApiError = { error: LaunchErrorCode; paused?: PauseReason };

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
);
