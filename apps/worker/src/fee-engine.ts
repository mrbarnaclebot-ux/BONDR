// The fee engine (D-07, D-09, D-10, D-12): every unbonded coin's window timer, one serial queue per coin, and
// the trade hook that keeps each coin's fee state in memory. Windows run from launch and are derived, never
// stored: a restart re-arms the current window's end and nothing is retroactive. Timers and hooks read memory
// only (D-03); Postgres is read once at boot.
// ponytail: one replica, all engine state in this process. Add a Postgres advisory lock if the worker ever
// runs two, or both would send every window.
import type { Venue } from "@bondr/core/api";
import type { AdminCoinMemory, AdminHealth } from "@bondr/core/api-admin";
import { type LandedRow, totalsFor, windowEnd, windowOf } from "@bondr/core/fees";
import { redact } from "@bondr/core/net";
import type { CoinPatch } from "@bondr/core/trades";
import { type Keypair, PublicKey } from "@solana/web3.js";
import { bondedJob, forceDue, forcedJob } from "./fee-burns.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { windowJob } from "./fee-guard.ts";
import type { Entry } from "./fee-ledger.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";
import { codeOf, type Failure, STUCK_AT, stepOf, type Verdict, verdict } from "./fee-stuck.ts";

export { STUCK_AT };

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
  heldReason?: string | null; // coins.held_reason, set with held_at (A4)
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
// The job logs its summary and hands its result on, so the queue can record a failed or landed step.
const report = (what: string) => (out: Landed[]) => {
  console.log(`${what}: ${summary(out)}`);
  return out;
};

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
      ...(r.heldReason ? { hold: r.heldReason } : {}),
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
  private readonly failures = new Map<string, Failure>(); // since boot (D-26); nothing auto-pauses a job (D-20)
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
    return this.track(mint, (this.queue.get(mint) ?? Promise.resolve()).then(job), what, logged(what));
  }

  // Admin work on a coin's queue in every mode (D-16, Pitfall 9): fn's result or error goes to the caller,
  // while the stored tail swallows it so later jobs on the coin still run.
  exclusive<T>(mint: string, fn: () => Promise<T>, what = `admin ${mint}`): Promise<T> {
    const run = (this.queue.get(mint) ?? Promise.resolve()).then(fn);
    void this.track(mint, run, what);
    return run;
  }

  // EVACUATE's batch wait: resolves once every job queued on these mints at call time has settled.
  async idle(mints: string[]): Promise<void> {
    await Promise.all(mints.map((m) => this.queue.get(m)));
  }

  coin = (mint: string): FeeCoin | undefined => this.coins.get(mint);

  // The manual hold (A4), never finalize; a reset clears only a finalize-held coin, not a finalized one.
  setHold(mint: string, reason: string | null, resetFinalize = false): void {
    const coin = this.coins.get(mint);
    if (!coin) return;
    coin.hold = reason ?? undefined;
    if (resetFinalize && coin.finalize === "held") coin.finalize = "none";
  }

  memory(): AdminCoinMemory[] {
    return [...this.coins].map(([mint, coin]) => {
      const f = this.failures.get(mint);
      const stuck = f && f.attempts >= STUCK_AT ? { ...f } : null;
      return { mint, stuck, hold: coin.hold ?? null, busy: this.busy(mint) };
    });
  }

  stuckCount(): AdminHealth["stuck"] {
    const stuck = [...this.failures]
      .filter(([, f]) => f.attempts >= STUCK_AT)
      .sort(([, a], [, b]) => a.at - b.at);
    const [mint, f] = stuck[0] ?? [];
    return { count: stuck.length, first: mint && f ? { mint, step: f.step, attempts: f.attempts } : null };
  }

  private track(mint: string, run: Promise<unknown>, what: string, onError?: (e: unknown) => void) {
    const tail = run.then(
      (r) => this.note(mint, what, verdict(r)),
      (e) => {
        onError?.(e);
        this.note(mint, what, { fail: codeOf(e) });
      },
    );
    this.queue.set(mint, tail);
    void tail.then(() => this.queue.get(mint) === tail && this.queue.delete(mint));
    return tail;
  }

  // A repeat of the same step counts up; another step failing starts its own count.
  private note(mint: string, what: string, v: Verdict): void {
    if (v === "clear") this.failures.delete(mint);
    if (!v || v === "clear") return;
    const [prev, step] = [this.failures.get(mint), stepOf(what, mint)];
    const attempts = prev?.step === step ? prev.attempts + 1 : 1;
    this.failures.set(mint, { step, attempts, code: v.fail, at: Date.now() });
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
    const what = `fee finalize ${mint}`;
    void this.enqueue(mint, () => finalizeJob(deps, coin, deployer).then(report(what)), what);
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
    const what = `forced bond ${mint}`;
    const job = () => forcedJob(deps, coin).then(report(what));
    void this.enqueue(mint, job, what).then(() => this.forcing.delete(mint));
  }

  // FEE-03 on the migration event; complete alone runs nothing (Pitfall 6).
  private bonded(coin: FeeCoin): void {
    const [mint, deps] = [coin.mint.toBase58(), this.o.deps];
    if (!this.ready || !deps) return;
    const what = `fee bonded ${mint}`;
    void this.enqueue(mint, () => bondedJob(deps, coin).then(report(what)), what);
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
    const what = `fee window ${mint} ${index}`;
    if (deps) void this.enqueue(mint, () => windowJob(deps, coin, index).then(report(what)), what);
    this.arm(coin, Math.max(index + 1, windowOf(coin.launchedAt, Date.now(), this.o.windowMs)));
  }

  private clear(mint: string): void {
    clearTimeout(this.timers.get(mint));
    this.timers.delete(mint);
  }
}
