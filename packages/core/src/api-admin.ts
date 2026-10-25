// Admin contract types. Types only, no imports, no runtime code, so web may import it (D-15), like api.ts.
// Every amount is a decimal string of lamports or token base units. Later plans may add optional fields; they
// never rename one.

// D-18: the jobs a switch can pause; launches is the Phase 2 kill switch.
export type AdminJob = "launches" | "forcedBond" | "sweeps" | "finalize" | "buybackBurn";
export type AdminSwitches = Record<AdminJob, boolean>;
export type FeeJob = Exclude<AdminJob, "launches">;

// D-12: actions that build a transaction, so they simulate first and run from a signed intent.
export type AdminTxAction =
  | "sweep_now"
  | "retry_forced_bond"
  | "burn_w_tokens"
  | "run_migrate"
  | "finalize_split"
  | "retry_sweep"
  | "distribute_now"
  | "sweep_leftovers"
  | "burn_buyback"
  | "evacuate";

// D-13: actions that change worker state without a transaction.
export type AdminActAction = "hold" | "release_hold" | "recheck_launch";

// D-33: the same 18 names as the admin_audit_action CHECK in migration 0007.
export type AdminAuditAction =
  | AdminTxAction
  | AdminActAction
  | "switch"
  | "hide"
  | "unhide"
  | "block"
  | "unblock";

export type AuditResult = "pending" | "landed" | "failed" | "refused";

// D-22: the health strip. Times are epoch ms; null means never seen since boot.
export type AdminHealth = {
  bootAt: number;
  instance: string;
  lastStream: number | null;
  lastEngine: number | null;
  lastRuns: Record<"split" | "bondCheck" | "sweep" | "distribute" | "buyback", number | null>;
  rpc: { p50: number | null; p95: number | null; errorRate: number; rateLimited: number; count: number };
  stuck: { count: number; first: { mint: string; step: string; attempts: number } | null };
  switches: AdminSwitches;
  evacuatedAt: string | null;
  feeEngine: "off" | "dry" | "on";
  opsLow: boolean;
  evacuate: "simulate" | "on";
  sentry:
    | { configured: false }
    | { configured: true; web: number; worker: number; capped: boolean }
    | {
        configured: true;
        failed: true;
      };
};

// D-23: platform wallet balances, read live by the worker.
export type AdminBalances = {
  treasurySol: string;
  treasuryBondr: string;
  buybackSol: string;
  buybackBondr: string;
  opsSol: string;
  opsFloor: string;
  bondrSol: number | null;
  nextBurnAt: number;
};

// D-24: what only worker memory knows about a coin; Postgres supplies the rest of the row.
export type AdminCoinMemory = {
  mint: string;
  stuck: { step: string; attempts: number; code: string; at: number } | null;
  hold: string | null;
  busy: boolean;
};

export type AdminOverviewWorker = { balances: AdminBalances; coins: AdminCoinMemory[] };

// D-24: one coin's live fee wallet read for the detail panel.
export type AdminCoinLive = {
  mint: string;
  w: string;
  sol: string;
  bondr: string;
  tokens: string;
  memory: AdminCoinMemory;
  windowIndex: number;
  windowEndsAt: number;
};

// D-12: one before and after line of a simulation's balance table.
export type AdminBalanceRow = {
  name: string;
  before: string;
  after: string;
  change: string;
  unit: "SOL" | "BONDR" | "tokens" | "bps";
};

// D-35: what an EVACUATE simulation would move.
export type EvacuateTotals = {
  wallets: number;
  bondr: string;
  bondrSol: string;
  sol: string;
  burnedIn: number;
  failures: number;
};

// D-12: a dry run; intent is present only when ok, and the owner signs its message to execute.
export type AdminSimResult = {
  action: AdminTxAction;
  mint: string | null;
  ok: boolean;
  error?: string;
  steps: { ok: boolean; cu: number | null; estimated: boolean }[];
  cu: number;
  feeLamports: string;
  balances: AdminBalanceRow[];
  destinations: { ok: true; passed: string[] } | { ok: false; refused: string };
  nothing: boolean;
  intent?: { id: string; message: string; expiresAt: number };
  totals?: EvacuateTotals;
};

// D-12: an executed intent, polled until it settles.
export type AdminIntentView = {
  id: string;
  state: "sending" | "landed" | "failed" | "unknown" | "refused";
  sigs: string[];
  landed: number;
  total: number;
  code?: string;
  moved?: number;
  failed?: number;
};

// D-32: the transaction inspector's decoded view.
export type AdminInspect = {
  found: boolean;
  status?: "success" | "failed";
  slot?: number;
  feePayer?: { label: string; address: string };
  instructions?: { index: number; program: string; name: string; args: string[] }[];
  error?: string | null;
  explorer?: string;
};

// D-33: one admin_audit row as the log shows it.
export type AdminAuditRow = {
  id: string;
  at: string;
  actor: string;
  action: AdminAuditAction;
  mint: string | null;
  symbol: string | null;
  params: Record<string, unknown>;
  simulation: { ok: boolean; cu: number } | null;
  result: AuditResult;
  sigs: string[];
};

// D-29, D-30: hide and block answers; count is set when a lookup matched more than one coin.
export type ModerationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_match"
        | "ambiguous"
        | "already_hidden"
        | "invalid_wallet"
        | "already_blocked"
        | "no_reason";
      count?: number;
    };
