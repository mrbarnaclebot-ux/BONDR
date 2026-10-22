// The step 4 network sequence: pin, prepare, one Phantom signature, submit, then poll the row until it
// lands (RESEARCH Pattern 8). Bytes in and out only: base64 through atob and btoa, no Solana library (D-15).
import type {
  ApiError,
  LaunchErrorCode,
  LaunchView,
  Links,
  PrepareResult,
  SubmitResult,
} from "@bondr/core/api";
import { normalizeLink, parseSol } from "@bondr/core/rules";
import type { Dispatch } from "react";
import type { Action, Fields, Launch, Live, Pinned } from "@/components/launch-flow";
import type { WalletApi } from "@/components/wallet";

const POLL_MS = 1000;
// A row still prepared this long after polling began was never co-signed, and its blockhash (60-90 s) is
// dead, so nothing can land: the launch is over (web WR-04).
const PREPARED_MS = 150_000;

export type Row = 1 | 2 | 3 | 4 | 5;
export type Code = LaunchErrorCode | "rejected" | "switched" | "onchain";

/** The launch's public row; "not_found" when the server has none, null when the read failed. */
export async function getView(id: string): Promise<LaunchView | "not_found" | null> {
  const res = await fetch(`/api/launch/${id}`, { cache: "no-store" }).catch(() => null);
  if (res?.status === 404) return "not_found";
  return res?.ok ? ((await res.json().catch(() => null)) as LaunchView | null) : null;
}

export type Progress = {
  row: Row;
  failed: Code | null;
  sent: boolean;
  unknown?: boolean;
  cid?: string;
  bytes?: number;
  sig?: string;
};
export type Run = {
  state: Launch;
  live: Live;
  wallet: WalletApi;
  dispatch: Dispatch<Action>;
  set(p: Partial<Progress>): void;
  signal: AbortSignal;
  /** Called just before the signed wire is posted, so a reload can restore the launch. */
  posted(id: string): void;
};

export class Stop extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super(code);
    this.code = code;
  }
}

async function call<T>(url: string, body: FormData | object, signal: AbortSignal): Promise<T> {
  const init =
    body instanceof FormData
      ? { body }
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const res = await fetch(url, { method: "POST", ...init, signal }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (res?.ok && out) return out;
  throw new Stop(out?.error ?? "worker_unavailable");
}

function metaOf(f: Fields) {
  const links: Links = {};
  for (const k of ["x", "telegram", "website"] as const) {
    const r = normalizeLink(k, f[k]);
    if (r.ok && r.value) links[k] = r.value;
  }
  return {
    name: f.name.trim(),
    symbol: f.symbol.trim().toUpperCase(),
    description: f.description.trim(),
    links,
  };
}

// Pin, prepare and submit take the wallet from the consent session cookie, so none of them sends it.
async function pin(run: Run): Promise<Pinned> {
  if (run.state.pin) return run.state.pin;
  const form = new FormData();
  form.set("image", run.state.image?.file ?? "");
  form.set("meta", JSON.stringify(metaOf(run.state.fields)));
  const pinned = await call<Pinned>("/api/launch/pin", form, run.signal);
  run.dispatch({ type: "pinned", pin: pinned });
  return pinned;
}

async function prepare(run: Run, pinned: Pinned): Promise<PrepareResult> {
  const solIn = parseSol(run.state.devBuy);
  if (!solIn.ok || !run.state.exit) throw new Stop("invalid_input");
  const { uri, imageCid, proof } = pinned;
  const body = { ...metaOf(run.state.fields), uri, imageCid, proof, solIn: String(solIn.value) };
  return call<PrepareResult>("/api/launch/prepare", { ...body, exit: run.state.exit }, run.signal);
}

// Pitfall 3: past signBy the blockhash is dead, so a late signature is refused here, not at the worker.
async function signWithin(run: Run, prep: PrepareResult): Promise<string> {
  const tx = Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Stop("expired")), prep.signBy * 1000);
  });
  const signing = run.wallet.signTransaction(tx).catch(() => Promise.reject(new Stop("rejected")));
  try {
    return btoa(String.fromCharCode(...(await Promise.race([signing, expiry]))));
  } finally {
    clearTimeout(timer);
  }
}

// D-16: once posted, a lost answer is settled by polling, never by a fresh signature. The worker treats a
// repeat of the same wire as a read, so a row still "prepared" gets the same wire again.
async function submit(id: string, signed: string, signal: AbortSignal): Promise<SubmitResult | null> {
  return call<SubmitResult>("/api/launch/submit", { launchId: id, signed }, signal).catch((e: Stop) =>
    e.code === "worker_unavailable" ? null : Promise.reject(e),
  );
}

export async function poll(run: Run, id: string, resend?: () => Promise<unknown>): Promise<void> {
  const start = Date.now();
  while (!run.signal.aborted) {
    const v = await getView(id);
    if (v === "not_found") throw new Stop("not_found");
    if (v?.state === "landed") return run.dispatch({ type: "live", view: v });
    if (v?.state === "failed")
      throw new Stop(v.error === "paused" || v.error === "cosign_refused" ? v.error : "onchain");
    if (v?.state === "prepared" && Date.now() - start > PREPARED_MS) throw new Stop("expired");
    if (v?.state === "prepared") await resend?.();
    if (v) run.set({ sig: v.signature ?? undefined, unknown: v.state === "unknown" });
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

export async function launch(run: Run): Promise<void> {
  if (!run.wallet.address) throw new Stop("switched");
  const pinned = await pin(run);
  run.set({ row: 2, cid: pinned.cid });
  const prep = await prepare(run, pinned);
  run.dispatch({ type: "prepared", launchId: prep.launchId, mint: prep.mint });
  run.set({ row: 3, bytes: prep.bytes });
  const signed = await signWithin(run, prep);
  if (run.signal.aborted) return;
  run.set({ row: 4, sent: true });
  run.posted(prep.launchId);
  const out = await submit(prep.launchId, signed, run.signal);
  run.set({ row: 5, sig: out?.signature });
  await poll(run, prep.launchId, () => submit(prep.launchId, signed, run.signal));
}

/** Insufficient balance, missing consent and an unknown launch each leave step 4. */
