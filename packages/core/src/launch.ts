// Launch instruction builders (RESEARCH Pattern 2). BONDR owns amounts, order and signing; the SDK owns
// every account list, because pump changes them on short notice.
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type BN, PUMP_SDK, type PumpQuoteAccounts } from "./pump.ts";

export type Coin = { name: string; symbol: string; uri: string };

// creatorFeeBps is passed only when given: devnet refuses any configured rate (Pitfall 7).
export function buildCreate(
  o: Coin & {
    mint: PublicKey;
    creator: PublicKey;
    user: PublicKey;
    quoteMint?: PublicKey;
    pumpQuote?: PumpQuoteAccounts;
    creatorFeeBps?: BN;
  },
): Promise<TransactionInstruction> {
  return PUMP_SDK.createV2Instruction({
    mint: o.mint,
    name: o.name,
    symbol: o.symbol,
    uri: o.uri,
    creator: o.creator,
    user: o.user,
    mayhemMode: false,
    ...(o.quoteMint && {
      quoteMint: o.quoteMint,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
      pumpQuote: o.pumpQuote,
    }),
    ...(o.creatorFeeBps && { creatorFeeBps: o.creatorFeeBps }),
  });
}
