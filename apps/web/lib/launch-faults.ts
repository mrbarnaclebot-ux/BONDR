// The step 4 failure table (UI-SPEC), moved out of launch-sign.tsx for the 300-line rule. Pure copy with no React,
// so it can be read and tested on its own.
import type { Code, Row } from "./launch-run";

export const NOT_FOUND = "We could not find that launch. Start again.";

export type Fault = { row?: Row; text: string; action: "Try again" | "Build again" | null };

export const BUILD_FAILED: Fault = {
  text: "Could not build your launch transaction. Nothing was sent. Try again.",
  action: "Try again",
};
// UI-SPEC step 4 failure table. A fault marks the row that was running unless it names one. The first three
// leave step 4 instead (see leave()); a code missing here falls back to Build failed, so none is silent.
export const FAULTS: Record<Code, Fault> = {
  insufficient_balance: { text: "", action: null },
  consent_required: { text: "", action: null },
  not_found: { text: NOT_FOUND, action: null },
  pin_failed: {
    text: "Could not pin your image and metadata to IPFS. Nothing was sent. Try again.",
    action: "Try again",
  },
  pool_empty: {
    text: "No bndr addresses are ready right now. Nothing was sent. Try again in a few minutes.",
    action: "Try again",
  },
  rate_limited: {
    text: "Too many launch attempts from this wallet. Nothing was sent. Wait a minute, then try again.",
    action: null,
  },
  build_failed: BUILD_FAILED,
  worker_unavailable: BUILD_FAILED,
  invalid_input: BUILD_FAILED,
  slippage: BUILD_FAILED, // trade codes; a launch never gets them
  message_changed: BUILD_FAILED,
  // D-30: a fixed line with no action; the owner's reason never reaches the deployer.
  blocked: { text: "This wallet cannot launch coins on BONDR.", action: null },
  // Admin codes; a launch never gets them.
  forbidden: BUILD_FAILED,
  intent_expired: BUILD_FAILED,
  intent_used: BUILD_FAILED,
  bad_intent_signature: BUILD_FAILED,
  not_applicable: BUILD_FAILED,
  simulation_failed: BUILD_FAILED,
  destination_refused: BUILD_FAILED,
  rpc_failed: BUILD_FAILED,
  rejected: {
    text: "Phantom rejected the request. Nothing was sent and no SOL left your wallet. Your mint address stays reserved for 10 minutes.",
    action: "Try again",
  },
  expired: {
    row: 3,
    text: "This transaction expired before it was signed. Nothing was sent. Build a fresh one.",
    action: "Build again",
  },
  switched: {
    text: "Phantom switched accounts. Nothing was sent. Start signing again with the account you want to launch from.",
    action: "Try again",
  },
  cosign_refused: {
    text: "BONDR did not co-sign. The signed transaction did not match the one BONDR built, so nothing was sent. Try again; if it repeats, disconnect and reconnect Phantom.",
    action: "Try again",
  },
  paused: {
    text: "Launches were paused before your launch was sent. Nothing was sent. Your details are kept; launch when the pause lifts.",
    action: null,
  },
  onchain: {
    text: "Your launch failed on-chain. Only the network fee left your wallet. Try again.",
    action: "Try again",
  },
  // D-43, D-44: the text comes from tickerFault at render time (it needs the symbol and the wait); a retry would
  // be refused again, so neither has an action.
  ticker_locked: { text: "", action: null },
  ticker_reserved: { text: "", action: null },
};
