// Creator fee sharing (RESEARCH Pattern 5). update_fee_shares_v2 revokes the admin after its one use, so
// finalizeIxs is the only shares write a BONDR coin ever makes. Sweeps go first (Pitfall 6).
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { creatorVaultPda, feeSharingConfigPda, PUMP_SDK } from "./pump.ts";

// PROJECT.md 80/20: deployer, then treasury. Locked after the one allowed update, so it lives here only.
export const FINAL_SHARES = { deployer: 8000, treasury: 2000 } as const;
// pump-fees allocates SharingConfig::MAX_SIZE for the PDA (CREATOR_FEE_SHARING.md), paid by the creator.
export const SHARING_CONFIG_SIZE = 1024;

type Shareholder = { address: PublicKey; shareBps: number };
type Sweep = {
  payer: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  quoteMint: PublicKey;
  pool?: PublicKey;
};

// Pool fees only exist once the coin bonded; on a live curve the pool sweep is skipped.
async function sweeps(o: Sweep): Promise<TransactionInstruction[]> {
  const q = { payer: o.payer, mint: o.mint, quoteMint: o.quoteMint, quoteTokenProgram: T22 };
  const curve = await PUMP_SDK.sweepCreatorFeeInstruction({ ...q, creator: o.creator });
  if (!o.pool) return [curve];
  return [curve, await PUMP_SDK.sweepPoolCreatorFeeInstruction({ ...q, coinCreator: o.creator })];
}

function vaultAta(payer: PublicKey, mint: PublicKey, quoteMint: PublicKey): TransactionInstruction {
  const vault = creatorVaultPda(feeSharingConfigPda(mint));
  const ata = getAssociatedTokenAddressSync(quoteMint, vault, true, T22);
  return createAssociatedTokenAccountIdempotentInstruction(payer, ata, vault, quoteMint, T22);
}

// [sweep curve fee, (sweep pool fee), create_fee_sharing_config, config vault ATA, update to FINAL_SHARES].
// The config makes its PDA the curve creator, and the update's inner distribute reads that PDA's creator
// vault quote ATA, which a sweep only creates when it moves fees (devnet: InvalidAccountData without it).
export async function finalizeIxs(o: {
  creator: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  deployer: PublicKey;
  treasury: PublicKey;
  pool?: PublicKey;
}): Promise<TransactionInstruction[]> {
  return [
    ...(await sweeps(o)),
    await PUMP_SDK.createFeeSharingConfig({ creator: o.creator, mint: o.mint, pool: o.pool ?? null }),
    vaultAta(o.payer, o.mint, o.quoteMint),
    await PUMP_SDK.updateFeeSharesV2({
      authority: o.creator,
      mint: o.mint,
      currentShareholders: [o.creator],
      newShareholders: [
        { address: o.deployer, shareBps: FINAL_SHARES.deployer },
        { address: o.treasury, shareBps: FINAL_SHARES.treasury },
      ],
      quoteMint: o.quoteMint,
      quoteTokenProgram: T22,
      bondingCurveComplete: o.pool !== undefined,
    }),
  ];
}

// Any later update. After finalize the curve's creator is the sharing config PDA, so the sweeps use it.
export async function updateIxs(o: {
  authority: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  current: PublicKey[];
  next: Shareholder[];
  pool?: PublicKey;
}): Promise<TransactionInstruction[]> {
  const creator = feeSharingConfigPda(o.mint);
  return [
    ...(await sweeps({ ...o, payer: o.authority, creator })),
    await PUMP_SDK.updateFeeSharesV2({
      authority: o.authority,
      mint: o.mint,
      currentShareholders: o.current,
      newShareholders: o.next,
      quoteMint: o.quoteMint,
      quoteTokenProgram: T22,
      bondingCurveComplete: o.pool !== undefined,
    }),
  ];
}

// OnlinePumpSdk has no SharingConfig fetcher, so this reads the PDA and decodes through the SDK.
export async function readSharing(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(feeSharingConfigPda(mint));
  if (!info) throw new Error(`no SharingConfig for ${mint.toBase58()}`);
  const c = PUMP_SDK.decodeSharingConfig(info);
  return {
    shares: c.shareholders.map((s) => s.shareBps),
    holders: c.shareholders.map((s) => s.address.toBase58()),
    adminRevoked: c.adminRevoked,
  };
}
