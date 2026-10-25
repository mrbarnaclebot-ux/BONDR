// The fee engine (D-07, D-09, D-10, D-12): every unbonded coin's window timer, one serial queue per coin, and
// the trade hook that keeps each coin's fee state in memory. Windows run from launch and are derived, never
// stored: a restart re-arms the current window's end and nothing is retroactive. Timers and hooks read memory
// only (D-03); Postgres is read once at boot.
// ponytail: one replica, all engine state in this process. Add a Postgres advisory lock if the worker ever
// runs two, or both would send every window.
import type { Venue } from "@bondr/core/api";
import { type LandedRow, totalsFor, windowEnd, windowOf } from "@bondr/core/fees";
import { redact } from "@bondr/core/net";
import type { CoinPatch } from "@bondr/core/trades";
import { type Keypair, PublicKey } from "@solana/web3.js";
import { bondedJob, forceDue, forcedJob } from "./fee-burns.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { windowJob } from "./fee-guard.ts";
import type { Entry } from "./fee-ledger.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

export type Mode = "off" | "dry" | "on";
export type WOf = (mint: string) => Keypair;
export type CoinLoad = {
  mint: string;
  w: string; // launches.w
  launchSig: string | null;
  wallet: string;
  launchedAt: Date | number;
  venue: string;
  feeBudget: string;
  feesUnclaimed: string;
  cost: string | null;
  finalize: string;
};
export type Launched = { mint: string; launchedAt: number; launchSig: string; wallet: string };
// What one committed ingest wrote: its coin patches, the trades it inserted (for their slot) and a new launch.
export type Ingested = {
  patches: CoinPatch[];
  inserted: { mint: string; slot: string }[];
  bonded?: ReadonlySet<string>;
  launched?: Launched;
};
type Opts = { mode: Mode; deps?: FeeDeps; windowMs: number; wOf: WOf };

const RANK: Record<Venue, number> = { curve: 0, complete: 1, pool: 2 };

export const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

const summary = (out: Landed[]) => out.map((l) => l.state).join(", ") || "nothing";

// T-05-05-02: the engine signs only for coins whose W derives from this seed (other lanes, seeded fakes).
export function coinFrom(r: CoinLoad, wOf: WOf): FeeCoin | undefined {
  const w = wOf(r.mint);
  try {
    if (w.publicKey.toBase58() !== r.w) throw new Error("W does not derive from this seed");
    const big = BigInt;
    return {
      ...{ mint: new PublicKey(r.mint), w, launchedAt: +r.launchedAt, venue: r.venue as Venue },
      ...{ feesUnclaimed: big(r.feesUnclaimed), feeBudget: big(r.feeBudget), launchSig: r.launchSig ?? "" },
      ...{ cost: r.cost === null ? null : big(r.cost), wallet: new PublicKey(r.wallet) },
      finalize: r.finalize as FeeCoin["finalize"],
    };
  } catch (e) {
    console.warn(`fee engine: ${r.mint} skipped: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

export class Engine {
  readonly coins = new Map<string, FeeCoin>();
  private readonly o: Opts;
  private readonly queue = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly slots = new Map<string, bigint>(); // newest trade slot applied per coin (Pitfall 10)
  private readonly forcing = new Set<string>(); // a forced bond is queued or running
  private ready = false;

  constructor(o: Opts) {
    this.o = o;
  }

  isReady = (): boolean => this.ready;
  busy = (mint: string): boolean => this.queue.has(mint); // a job is queued or running on the mint

  add(r: CoinLoad): boolean {
    if (this.o.mode === "off") return false;
    const coin = coinFrom(r, this.o.wOf);
    if (!coin) return false;
    this.coins.set(r.mint, coin);
    if (this.ready) this.arm(coin);
    return true;
  }

  // After boot recovery: from here on hooks and timers enqueue jobs. A pooled coin not yet finalized gets its
  // bonded job again, in case a restart dropped it (D-10). Returns the coins armed.
  start(): number {
    if (this.o.mode === "off") return 0;
    this.ready = true;
    for (const coin of this.coins.values()) {
      this.arm(coin);
      if (coin.venue === "pool" && coin.finalize === "none") this.bonded(coin);
    }
    return this.timers.size;
  }

  // Serial per mint: a job starts when the previous one on that mint settled, whatever its outcome.
  enqueue(mint: string, job: () => Promise<unknown>, what = `fee job ${mint}`): Promise<void> {
    if (this.o.mode === "off") return Promise.resolve();
    const next = (this.queue.get(mint) ?? Promise.resolve()).then(job).then(() => {}, logged(what));
    this.queue.set(mint, next);
    void next.then(() => this.queue.get(mint) === next && this.queue.delete(mint));
    return next;
  }

  onIngest(w: Ingested): void {
    if (this.o.mode === "off") return;
    const l = w.launched;
    if (l && !this.coins.has(l.mint)) {
      const fresh = { ...l, w: this.o.wOf(l.mint).publicKey.toBase58(), venue: "curve", cost: null };
      this.add({ ...fresh, feeBudget: "0", feesUnclaimed: "0", finalize: "none" });
    }
    for (const p of w.patches) {
      const coin = this.coins.get(p.mint);
      if (!coin) continue;
      const was = coin.venue;
      this.apply(coin, p, w.inserted.findLast((t) => t.mint === p.mint)?.slot);
      if (coin.venue !== "curve") this.clear(p.mint);
      if (was !== "pool" && coin.venue === "pool") this.bonded(coin);
      else if (!p.venue) this.force(coin);
    }
  }

  // The memory side of a landing; Postgres moved the same totals in the landing's transaction.
  landed(mint: string | null, rows: Entry[]): void {
    const coin = mint ? this.coins.get(mint) : undefined;
    if (!coin) return;
    for (const r of rows) {
      const t = totalsFor(r.kind, { ...r, detail: r.detail as LandedRow["detail"] });
      const budget = coin.feeBudget + (t.add.fee_budget ?? 0n);
      coin.feeBudget = budget > 0n ? budget : 0n;
      if (t.set?.feesUnclaimed === 0n) coin.feesUnclaimed = 0n;
      if (t.set?.finalize) coin.finalize = t.set.finalize;
    }
  }

  // D-18 owner release: one finalize of a held coin with the owner's deployer. False when the coin is not held.
  release(mint: string, deployer: PublicKey): boolean {
    const [coin, deps] = [this.coins.get(mint), this.o.deps];
    if (!this.ready || !deps || coin?.finalize !== "held") return false;
    const job = async () =>
      console.log(`fee finalize ${mint}: ${summary(await finalizeJob(deps, coin, deployer))}`);
    void this.enqueue(mint, job, `fee finalize ${mint}`);
    return true;
  }

  // Venue only advances; fee numbers move only for a trade at least as new as the last one applied.
  private apply(coin: FeeCoin, p: CoinPatch, slot: string | undefined): void {
    if (p.venue && RANK[p.venue] > RANK[coin.venue]) coin.venue = p.venue;
    if (slot === undefined || BigInt(slot) < (this.slots.get(p.mint) ?? -1n)) return;
    this.slots.set(p.mint, BigInt(slot));
    if (p.feesUnclaimed !== undefined) coin.feesUnclaimed = BigInt(p.feesUnclaimed);
    if (p.costToComplete !== undefined) coin.cost = BigInt(p.costToComplete);
  }

  // D-15: memory says the budget clears 105% of the cost; forcedJob re-checks on chain before sending.
  private force(coin: FeeCoin): void {
    const [mint, deps, cost] = [coin.mint.toBase58(), this.o.deps, coin.cost];
    if (!this.ready || !deps || coin.venue !== "curve" || !cost || this.forcing.has(mint)) return;
    if (!forceDue(coin, cost)) return;
    this.forcing.add(mint);
    const job = async () => console.log(`forced bond ${mint}: ${summary(await forcedJob(deps, coin))}`);
    void this.enqueue(mint, job, `forced bond ${mint}`).then(() => this.forcing.delete(mint));
  }

  // FEE-03 on the migration event; complete alone runs nothing (Pitfall 6).
  private bonded(coin: FeeCoin): void {
    const [mint, deps] = [coin.mint.toBase58(), this.o.deps];
    if (!this.ready || !deps) return;
    const job = async () => console.log(`fee bonded ${mint}: ${summary(await bondedJob(deps, coin))}`);
    void this.enqueue(mint, job, `fee bonded ${mint}`);
  }

  private arm(coin: FeeCoin, index = windowOf(coin.launchedAt, Date.now(), this.o.windowMs)): void {
    const mint = coin.mint.toBase58();
    this.clear(mint);
    if (!this.ready || coin.venue !== "curve") return;
    const ms = windowEnd(coin.launchedAt, index, this.o.windowMs) - Date.now();
    this.timers.set(
      mint,
      setTimeout(() => this.fire(coin, index), Math.max(0, ms)),
    );
  }

  private fire(coin: FeeCoin, index: number): void {
    const [mint, deps] = [coin.mint.toBase58(), this.o.deps];
    this.timers.delete(mint);
    if (deps)
      void this.enqueue(
        mint,
        async () =>
          console.log(`fee window ${mint} ${index}: ${summary(await windowJob(deps, coin, index))}`),
        `fee window ${mint} ${index}`,
      );
    this.arm(coin, Math.max(index + 1, windowOf(coin.launchedAt, Date.now(), this.o.windowMs)));
  }

  private clear(mint: string): void {
    clearTimeout(this.timers.get(mint));
    this.timers.delete(mint);
  }
}
