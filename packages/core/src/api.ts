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
  | "worker_unavailable";

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
