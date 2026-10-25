// Finalize a bonded coin (FEE-05, D-18, RESEARCH Pattern 6): read where it stands from chain, check the
// deployer, then the two proven txs (sweeps + create_fee_sharing_config, then the sweep + the one 8000/2000
// update) and a closing sweep that empties W. The update is permanent, so a wrong deployer must never reach it:
// any doubt holds the coin until the owner releases it (POST /fee/release). Nothing here is urgent.
import { innerEvents } from "@bondr/core/events";
import { deployerOk, windowOf } from "@bondr/core/fees";
import { redact } from "@bondr/core/net";
import { fetchTx } from "@bondr/core/send";
import {
  FINAL_SHARES,
  finalizeConfigIxs,
  finalizeState,
  finalizeUpdateIxs,
  readSharing,
  SHARING_CONFIG_SIZE,
} from "@bondr/core/sharing";
import {
  type ConfirmedTransactionMeta,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { spend } from "./fee-guard.ts";
import type { NewEntry } from "./fee-ledger.ts";
import { collectJob, settled, sweepJob, wBondr } from "./fee-prebond.ts";
import { type FeeCoin, type FeeDeps, factsFor, type Landed } from "./fee-send.ts";

const W_BUFFER = 0.01 * LAMPORTS_PER_SOL; // proven float on top of the config rent (01-08)
const CU = 600_000;
const ADMIN_REVOKED = 6009; // pump-fees SharingConfigAdminRevoked: the one update already happened
const DONE: Landed = { state: "done" };

// D-18: a held row and a Sentry error (console.error). Dry mode writes nothing, as everywhere in the engine.
async function hold(d: FeeDeps, coin: FeeCoin, reason: string): Promise<null> {
  const mint = coin.mint.toBase58();
  if (d.mode === "on") {
    await d.ledger.hold(mint, reason);
    coin.finalize = "held";
  }
  console.error(`finalize held ${mint}: ${reason}`);
  return null;
}

// The deployer is the launch tx's CreateEvent user (innerEvents proves the event authority), and it must be
// the launch wallet. An owner override replaces that equality with the owner's call; the distinct and on-curve
// checks still run. An RPC failure throws (retried at the next boot or batch) and is never a hold.
export async function preflight(d: FeeDeps, coin: FeeCoin, override?: PublicKey): Promise<PublicKey | null> {
  const mint = coin.mint.toBase58();
  let deployer = override?.toBase58();
  if (!deployer) {
    if (!coin.launchSig) return hold(d, coin, "no launch signature");
    const tx = await fetchTx(d.conn, coin.launchSig);
    if (!tx) throw new Error(`launch tx of ${mint} not found yet`);
    const create = innerEvents(tx).find((e) => e.name === "CreateEvent" && e.data.mint === mint);
    if (!create) return hold(d, coin, "no CreateEvent of the coin in its launch tx");
    deployer = String(create.data.user);
  }
  const key = new PublicKey(deployer);
  const reason = deployerOk({
    ...{ deployer, wallet: override ? deployer : coin.wallet.toBase58() },
    ...{ treasury: d.treasury.toBase58(), w: coin.w.publicKey.toBase58() },
    onCurve: PublicKey.isOnCurve(key.toBytes()),
  });
  return reason ? hold(d, coin, reason) : key;
}

const base = (d: FeeDeps, coin: FeeCoin, pool: PublicKey) => ({
  ...{ payer: d.ops.publicKey, mint: coin.mint, creator: coin.w.publicKey, quoteMint: d.Q },
  ...{ bondingCurveComplete: true, pool },
});

// W signs both txs and pays the config rent, so ops floats it first. Each row's amount is W's BONDR delta:
// the sweeps and the update's inner distribution pay W the vault (01-08), and the closing sweep takes it.
function finalLand(d: FeeDeps, coin: FeeCoin, row: NewEntry, ixs: TransactionInstruction[]) {
  const w = coin.w.publicKey;
  const facts = (meta: ConfirmedTransactionMeta) => factsFor([row], meta, d.Q, w);
  return d.land({ rows: [row], ixs, signers: [coin.w], cu: CU, facts });
}

async function configTx(d: FeeDeps, coin: FeeCoin, pool: PublicKey): Promise<Landed> {
  const w = coin.w.publicKey;
  const rent = await d.conn.getMinimumBalanceForRentExemption(SHARING_CONFIG_SIZE);
  const lamports = rent + W_BUFFER - (await d.conn.getBalance(w));
  const fund =
    lamports > 0 ? [SystemProgram.transfer({ fromPubkey: d.ops.publicKey, toPubkey: w, lamports })] : [];
  const ixs = [...fund, ...(await finalizeConfigIxs(base(d, coin, pool)))];
  return finalLand(d, coin, { kind: "finalize_config", mint: coin.mint.toBase58() }, ixs);
}

async function updateTx(d: FeeDeps, coin: FeeCoin, pool: PublicKey, deployer: PublicKey): Promise<Landed> {
  const treasury = d.treasury;
  const detail = {
    ...{ dBps: FINAL_SHARES.deployer, tBps: FINAL_SHARES.treasury },
    ...{ deployer: deployer.toBase58(), treasury: treasury.toBase58() },
  };
  const ixs = await finalizeUpdateIxs({ ...base(d, coin, pool), deployer, treasury });
  return finalLand(d, coin, { kind: "finalize_update", mint: coin.mint.toBase58(), detail }, ixs);
}

// The shares are already locked (a 6009, or a revoked config on chain): done only if they are ours.
async function lockedFinal(d: FeeDeps, coin: FeeCoin, deployer: PublicKey): Promise<boolean> {
  const s = await readSharing(d.conn, coin.mint);
  const ours =
    s.shares.join() === `${FINAL_SHARES.deployer},${FINAL_SHARES.treasury}` &&
    s.holders.join() === `${deployer.toBase58()},${d.treasury.toBase58()}`;
  if (!ours) return (await hold(d, coin, `shares already locked as ${s.shares.join("/")}`)) ?? false;
  if (d.mode === "on") await d.ledger.markFinal(coin.mint.toBase58(), FINAL_SHARES.deployer);
  coin.finalize = "done";
  return true;
}

// Owner-delegated A6 (2026-10-25): W's post-bond, pre-update fees go to buyback and treasury like any window
// (collect, split, sweep; D-12). Tx1's pool sweep moves them into W's own coin creator vault and the update
// pays out nothing (fork, 05-08), so a collect comes first. After the update the creator is the sharing config,
// so this collect takes the last fee W will ever earn; no curve sweep (the curve names the config now).
async function closing(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  const out = [await collectJob(d, coin, false, false)];
  return spend(d, coin, out, () => sweepJob(d, coin, windowOf(coin.launchedAt, Date.now(), d.windowMs)));
}

// One read after the closing sweep: W should hold 0 BONDR and 0 child tokens. A miss is an error, not a throw.
async function checkEmpty(d: FeeDeps, coin: FeeCoin): Promise<void> {
  const mint = coin.mint.toBase58();
  try {
    const [child, bondr] = [await wBondr(d, coin, coin.mint), await wBondr(d, coin)];
    const line = `finalize ${mint}: W child ${child}, BONDR ${bondr}`;
    if (child === 0n && bondr === 0n) console.log(line);
    else console.error(line);
  } catch (e) {
    console.error(`finalize ${mint}: W read failed: ${redact(e instanceof Error ? e.message : String(e))}`);
  }
}

// Resumable from any step: the chain says which txs are left. The update is sent once; a 6009 is final.
async function finalTxs(d: FeeDeps, coin: FeeCoin, pool: PublicKey, deployer: PublicKey, sharing: string) {
  const out: Landed[] = [];
  if (sharing === "none") out.push(await configTx(d, coin, pool));
  if (!out.every(settled)) return { out, ok: false };
  if (sharing === "revoked") return { out, ok: await lockedFinal(d, coin, deployer) };
  const u = await updateTx(d, coin, pool, deployer);
  out.push(u);
  if (u.code === ADMIN_REVOKED) return { out, ok: await lockedFinal(d, coin, deployer) };
  return { out, ok: settled(u) };
}

// After the bond and its burn (bondedJob), the daily batch, or an owner release (override).
export async function finalizeJob(d: FeeDeps, coin: FeeCoin, override?: PublicKey): Promise<Landed[]> {
  if (coin.finalize === "done" || (coin.finalize === "held" && !override)) return [DONE];
  const s = await finalizeState(d.conn, coin.mint, d.Q);
  if (!s.complete || !s.pool) return [DONE];
  const deployer = await preflight(d, coin, override);
  if (!deployer) return [DONE];
  if (override && coin.finalize === "held" && d.mode === "on") {
    await d.ledger.release(coin.mint.toBase58());
    coin.finalize = "none";
  }
  const { out, ok } = await finalTxs(d, coin, s.pool, deployer, s.sharing);
  if (!ok) return out;
  out.push(...(await closing(d, coin)));
  await checkEmpty(d, coin);
  return out;
}
