// Creator fee sharing (RESEARCH Pattern 5). update_fee_shares_v2 revokes the admin after its one use, so
// finalizeUpdateIxs is the only shares write a BONDR coin ever makes. Sweeps go first (Pitfall 6).
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  creatorVaultPda,
  feeSharingConfigPda,
  type OnlinePumpSdk,
  PUMP_SDK,
} from "./pump.ts";

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
  bondingCurveComplete: boolean; // passed by the caller, who read the curve; pool is required when true
  pool?: PublicKey;
};

// Pool fees only exist once the coin bonded; on a live curve the pool sweep is skipped.
async function sweeps(o: Sweep): Promise<TransactionInstruction[]> {
  const q = { payer: o.payer, mint: o.mint, quoteMint: o.quoteMint, quoteTokenProgram: T22 };
  if (o.bondingCurveComplete && !o.pool) throw new Error(`bonded ${o.mint.toBase58()} needs its pool`);
  const curve = await PUMP_SDK.sweepCreatorFeeInstruction({ ...q, creator: o.creator });
  if (!o.bondingCurveComplete) return [curve];
  return [curve, await PUMP_SDK.sweepPoolCreatorFeeInstruction({ ...q, coinCreator: o.creator })];
}

function vaultAta(payer: PublicKey, mint: PublicKey, quoteMint: PublicKey): TransactionInstruction {
  const vault = creatorVaultPda(feeSharingConfigPda(mint));
  const ata = getAssociatedTokenAddressSync(quoteMint, vault, true, T22);
  return createAssociatedTokenAccountIdempotentInstruction(payer, ata, vault, quoteMint, T22);
}

type Finalize = Sweep & { deployer: PublicKey; treasury: PublicKey };

// The config makes its PDA the curve creator, and the update's inner distribute reads that PDA's creator vault
// quote ATA, which a sweep only creates when it moves fees (devnet: InvalidAccountData without it).
async function updateTail(o: Finalize): Promise<TransactionInstruction[]> {
  return [
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
      bondingCurveComplete: o.bondingCurveComplete,
    }),
  ];
}

// Tx 1 of the proven split (A2): [sweep curve fee, (sweep pool fee), create_fee_sharing_config].
export async function finalizeConfigIxs(o: Sweep): Promise<TransactionInstruction[]> {
  return [
    ...(await sweeps(o)),
    await PUMP_SDK.createFeeSharingConfig({ creator: o.creator, mint: o.mint, pool: o.pool ?? null }),
  ];
}

// Tx 2: the sweeps again under the new creator, the config vault ATA and the one update to FINAL_SHARES.
export async function finalizeUpdateIxs(o: Finalize): Promise<TransactionInstruction[]> {
  return [...(await configSweeps(o)), ...(await updateTail(o))];
}

// Both txs as one list, for the spike's size check: [sweeps, config, vault ATA, update].
export async function finalizeIxs(o: Finalize): Promise<TransactionInstruction[]> {
  return [...(await finalizeConfigIxs(o)), ...(await updateTail(o))];
}

// After create_fee_sharing_config the curve and pool creator is the sharing config PDA, so later sweeps
// name it, and a finalize split into two txs repeats them before the update (pump-fees 6033 otherwise). A
// complete curve takes no v3 trades, so after the finalize's curve sweep only the pool sweep is left; that
// keeps a bonded update with two shareholders under the packet limit (fork: 1,270 bytes with both).
export async function configSweeps(o: Omit<Sweep, "creator">): Promise<TransactionInstruction[]> {
  const all = await sweeps({ ...o, creator: feeSharingConfigPda(o.mint) });
  return o.bondingCurveComplete ? all.slice(1) : all;
}

// Any later update, after the same sweeps.
export async function updateIxs(o: {
  authority: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  current: PublicKey[];
  next: Shareholder[];
  bondingCurveComplete: boolean;
  pool?: PublicKey;
}): Promise<TransactionInstruction[]> {
  return [
    ...(await configSweeps({ ...o, payer: o.authority })),
    await PUMP_SDK.updateFeeSharesV2({
      authority: o.authority,
      mint: o.mint,
      currentShareholders: o.current,
      newShareholders: o.next,
      quoteMint: o.quoteMint,
      quoteTokenProgram: T22,
      bondingCurveComplete: o.bondingCurveComplete,
    }),
  ];
}

export type FinalizeState = {
  complete: boolean;
  pool: PublicKey | null;
  sharing: "none" | "configured" | "revoked";
};

// Where a finalize stands, from chain in one call, so a restart resumes at the right step (STATE blocker:
// complete and pool come from chain, never from a caller boolean). A missing curve reads as not complete.
export async function finalizeState(
  conn: Connection,
  mint: PublicKey,
  quoteMint: PublicKey,
): Promise<FinalizeState> {
  const pool = canonicalPumpPoolPdaWithQuote(mint, quoteMint);
  const keys = [bondingCurvePda(mint), pool, feeSharingConfigPda(mint)];
  const [curve, poolInfo, config] = await conn.getMultipleAccountsInfo(keys);
  const sharing = !config
    ? "none"
    : PUMP_SDK.decodeSharingConfig(config).adminRevoked
      ? "revoked"
      : "configured";
  return {
    complete: curve ? PUMP_SDK.decodeBondingCurve(curve).complete : false,
    pool: poolInfo ? pool : null,
    sharing,
  };
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

// Permissionless payout to the shareholders. The SDK list is [sweeps, transfer_creator_fees_to_pump_v2 when
// bonded, distribute_creator_fees_v2 with initialize_ata], and its order is kept as is (RESEARCH Don't
// Hand-Roll): distribution refuses an un-swept curve bucket.
export async function distributeIxs(o: {
  online: InstanceType<typeof OnlinePumpSdk>;
  mint: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
}): Promise<TransactionInstruction[]> {
  const opts = { quoteMint: o.quoteMint, quoteTokenProgram: T22, payer: o.payer };
  return (await o.online.buildDistributeCreatorFeesInstructions(o.mint, opts)).instructions;
}
