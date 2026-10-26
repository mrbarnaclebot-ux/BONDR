// Genesis mode boot (D-29): the worker on mainnet before BONDR exists. Every switch is written off, only the
// launch, status, switch and admin routes stay open, and after genesis the BONDR mint is proven on chain before
// the indexer boots (D-31).
import { readCurve } from "@bondr/core/curve";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { audited, pgAudit } from "./admin-audit.ts";
import { feeRoutes } from "./fee-routes.ts";
import { type GenesisCtx, genesisOne, genesisQuote } from "./genesis.ts";
import { fail, type Routes } from "./http.ts";
import { prepare } from "./prepare.ts";
import { setGenesis } from "./settle.ts";
import { liveStatus, setSwitch } from "./status.ts";
import { submit } from "./submit.ts";
import { gateFor } from "./switch-gate.ts";
import { loadSwitches, switchesLine, switchesOff, switchState } from "./switches.ts";

// Trades need a coin and the fee engine needs BONDR: neither exists before genesis lands.
export const NOT_READY_ROUTES = [
  ...["POST /trade/quote", "POST /trade/balance", "POST /trade/prepare", "POST /trade/submit"],
  "POST /trade/view",
  ...Object.keys(feeRoutes(() => null)),
];
const notReady = async (): Promise<never> => {
  throw fail({ error: "not_ready" });
};

// Unconditional: memory that was never loaded reads all off, but a fresh production database seeds every switch
// on (0000_init.sql), and leaving genesis must load them off so the owner opens each one (D-13, D-30).
export async function enterGenesis(): Promise<void> {
  await loadSwitches();
  const params = { job: "all", enabled: false };
  await audited(pgAudit(), { actor: "genesis", action: "switch", mint: null, params }, switchesOff);
  console.log(switchesLine(switchState()));
  setGenesis(true);
}

export function genesisRoutes(gctx: GenesisCtx, admin: Routes): Routes {
  return {
    "GET /status": () => liveStatus(gctx),
    "POST /quote": (body) => genesisQuote(gctx, body),
    "POST /prepare": (body) => prepare(gctx, body, genesisOne),
    "POST /submit": (body) => submit(gctx, body),
    "POST /kill-switch": (body) => setSwitch(body, pgAudit(), gateFor(gctx.env)),
    ...Object.fromEntries(NOT_READY_ROUTES.map((k) => [k, notReady])),
    ...admin,
  };
}

type Online = Parameters<typeof readCurve>[0];
// A SOL coin's curve names NATIVE_MINT, or the default key on layouts written before quote mints existed.
const SOL = new Set([NATIVE_MINT.toBase58(), PublicKey.default.toBase58()]);

// T-07-17-01: a wrong or copycat BONDR_QUOTE_MINT refuses to start. Messages name the fact, never the value.
export async function verifyQuoteMint(online: Online, Q: PublicKey, treasury: PublicKey): Promise<void> {
  const c = await readCurve(online, Q).catch(() => null);
  if (!c) throw new Error("BONDR_QUOTE_MINT has no pump curve (or the curve read failed)");
  if (!SOL.has(c.quoteMint)) throw new Error("BONDR_QUOTE_MINT is not a SOL-pair coin");
  if (c.creator !== treasury.toBase58()) throw new Error("BONDR_QUOTE_MINT's creator is not the treasury");
}
