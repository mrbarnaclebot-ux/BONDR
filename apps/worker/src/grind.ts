// The bndr grinder. One file for both sides: as a worker_threads thread it tries indexes and posts hits;
// in the main thread it runs the threads, stores (idx, pubkey) only, refills on demand and serves the CLI.
// CLI: node --env-file=.env apps/worker/src/grind.ts --count N --threads T | --check N
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { close, db } from "@bondr/core/db";
import { redact } from "@bondr/core/net";
import { vanityMints } from "@bondr/core/schema";
import { max } from "drizzle-orm";
import { loadEnv, type WorkerEnv } from "./env.ts";
import { isBndr, type Lane, mintKeyFor, poolSize } from "./vanity.ts";

type Grinder = Pick<WorkerEnv, "seed" | "net" | "lane">;
type Job = Grinder & { role: "vanity-grind"; start: bigint; step: bigint };
type Hit = { idx: bigint; pubkey: string };

// No yield: worker.terminate() interrupts a busy loop, and no message ever needs handling in the thread.
function thread(job: Job) {
  const seed = Buffer.from(job.seed);
  for (let idx = job.start; ; idx += job.step) {
    const pubkey = isBndr(seed, job.net, job.lane, idx);
    if (pubkey) parentPort?.postMessage({ idx, pubkey } satisfies Hit);
  }
}

if (!isMainThread && (workerData as Job | undefined)?.role === "vanity-grind") thread(workerData as Job);

// ponytail: restarts re-scan the gap after the last hit (a few minutes at most); store a next_idx row if that
// ever matters. Negative idx rows are test fixtures.
async function nextIdx(): Promise<bigint> {
  const [row] = await db()
    .select({ top: max(vanityMints.idx) })
    .from(vanityMints);
  return row?.top == null || row.top < 0n ? 0n : row.top + 1n;
}

// Thread k tries start + k, start + k + T, ... so threads never repeat an index. Resolves after count hits.
export async function grind(env: Grinder, count: number, threads: number): Promise<number> {
  const start = await nextIdx();
  const job = (k: number): Job => ({
    ...env,
    role: "vanity-grind",
    start: start + BigInt(k),
    step: BigInt(threads),
  });
  const pool = Array.from(
    { length: threads },
    (_, k) => new Worker(new URL(import.meta.url), { workerData: job(k) }),
  );
  let claimed = 0;
  let saved = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      for (const w of pool) {
        w.on("error", reject);
        w.on("message", (hit: Hit) => {
          if (claimed++ >= count) return;
          db()
            .insert(vanityMints)
            .values(hit)
            .onConflictDoNothing()
            .then(() => {
              console.log(`vanity ${hit.idx} ${hit.pubkey}`);
              if (++saved === count) resolve();
            }, reject);
        });
      }
    });
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  return saved;
}

// [low, target]: below low, grind up to target. Production must hold the 100 free mints child launches need (D-30).
// ponytail: fixed targets; make them env-tunable if pool demand varies between deploys.
const REFILL = { local: [10, 20], staging: [10, 20], production: [100, 150] } satisfies Record<
  Lane,
  [number, number]
>;

export function refillNeed(lane: Lane, ready: number): number {
  const [low, target] = REFILL[lane];
  return ready < low ? target - ready : 0;
}

let refilling = false;

// Call on boot and after each reservation. No timer, so an idle worker lets Neon scale to zero (Pitfall 6).
export async function startRefill(env: Grinder & { vanityThreads: number }): Promise<void> {
  if (refilling || env.vanityThreads === 0) return;
  refilling = true;
  try {
    const ready = await poolSize(db());
    // 02-14 routes this warning to Sentry.
    if (ready < 3) console.warn(`vanity pool low: ${ready} ready`);
    const need = refillNeed(env.lane, ready);
    if (need > 0) await grind(env, need, env.vanityThreads);
  } catch (e) {
    console.error(`vanity refill failed: ${redact(e instanceof Error ? e.message : String(e))}`);
  } finally {
    refilling = false;
  }
}

function valid(env: Grinder, row: Hit): boolean {
  try {
    mintKeyFor(row, env.seed, env.net, env.lane);
    return row.pubkey.endsWith("bndr");
  } catch {
    return false;
  }
}

// Ready count must reach min, and every stored row must end in bndr and re-derive from this seed and lane.
async function check(env: Grinder, min: number): Promise<boolean> {
  const rows = await db().select().from(vanityMints);
  const bad = rows.filter((r) => !valid(env, r));
  const ready = await poolSize(db());
  console.log(`vanity ${env.lane}: ${ready} ready, ${rows.length} stored, ${bad.length} bad`);
  for (const r of bad) console.log(`bad row ${r.idx} ${r.pubkey}`);
  return ready >= min && bad.length === 0;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new Error("--count, --threads and --check take an integer >= 1");
  return n;
};

async function cli() {
  const opts = { count: { type: "string" }, threads: { type: "string" }, check: { type: "string" } } as const;
  const { values } = parseArgs({ options: opts });
  const env = loadEnv();
  if (values.check !== undefined) {
    process.exitCode = (await check(env, positive(values.check, 1))) ? 0 : 1;
    return;
  }
  const threads = positive(values.threads, 1);
  const [t0, from] = [Date.now(), await nextIdx()];
  const hits = await grind(env, positive(values.count, 1), threads);
  const secs = (Date.now() - t0) / 1000;
  // Keys tried up to the last hit; a close lower bound for the rate.
  const rate = Math.round(Number((await nextIdx()) - from) / secs / threads);
  console.log(
    `vanity ${env.lane}: ${hits} new in ${Math.round(secs)} s, ${threads} threads, ${rate} keys/s/thread`,
  );
}

if (isMainThread && import.meta.main)
  cli()
    .catch((e: unknown) => {
      console.error(`grind failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exitCode = 1;
    })
    .finally(() => close());
