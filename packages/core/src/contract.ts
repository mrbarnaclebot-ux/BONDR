// The pump contract check (OPS-02, D-18..D-21). Pump can redeploy at any time and BONDR builds transactions
// against its layouts and fee schedule, so the worker checks the programs, the account layouts and the Global
// flags at boot and weekly, and pauses on any fact. The gatherer reads RPC only (about 4 calls, no Postgres);
// the judge is pure so both measured networks are tested without a network.
import { NATIVE_MINT } from "@solana/spl-token";
import { type AccountInfo, type Connection, PublicKey } from "@solana/web3.js";
import { configFacts } from "./config.ts";
import type { Net } from "./keys.ts";
import {
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  GLOBAL_CONFIG_PDA,
  GLOBAL_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_SDK,
  PUMP_FEE_CONFIG_PDA,
  PUMP_FEE_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  pumpAmmJson,
  pumpIdl,
} from "./pump.ts";

export type Facts = Record<string, string | number | boolean>;
export type ProgramName = "pump" | "pump AMM" | "pump fees";
export type ProgramFact = { name: ProgramName; executable: boolean; owner: string | null };
export type AccountFact = {
  name: string;
  size: number;
  owner: string | null;
  disc: string;
  decodes: boolean;
};
// config is null when the Global or a FeeConfig account is missing or no longer decodes (CR-W-02).
export type CheckInput = { programs: ProgramFact[]; accounts: AccountFact[]; config: Facts | null };
export type CheckResult = { facts: string[]; slots: Record<ProgramName, string> };

// PROJECT.md "Fee Mechanic" item 3 and the depth-1 pump coin quote from item 1, per network. Devnet has the
// creator fee off by design and an unset exotic AMM schedule (LP 25), measured 2026-10-26 (Pitfall 6).
export type Profile = {
  creatorFeeConfigurable: boolean; // false: the max creator fee is not checked either
  curveCreator: number;
  curveProtocol: number;
  ammLp: number;
  ammProtocol: number;
  minCurveDepth: number;
};
const MAINNET: Profile = {
  ...{ creatorFeeConfigurable: true, curveCreator: 150, curveProtocol: 95 },
  ...{ ammLp: 20, ammProtocol: 5, minCurveDepth: 1 },
};
export const PROFILES: Record<Net, Profile> = {
  mainnet: MAINNET,
  fork: MAINNET,
  devnet: { ...MAINNET, creatorFeeConfigurable: false, ammLp: 25 },
};

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAMS: [ProgramName, PublicKey][] = [
  ["pump", PUMP_PROGRAM_ID],
  ["pump AMM", PUMP_AMM_PROGRAM_ID],
  ["pump fees", PUMP_FEE_PROGRAM_ID],
];
const IDS = Object.fromEntries(PROGRAMS.map(([n, id]) => [n, id.toBase58()])) as Record<ProgramName, string>;
const disc = (idl: unknown, name: string) => {
  const accounts = (idl as { accounts: { name: string; discriminator: number[] }[] }).accounts;
  return Buffer.from(accounts.find((a) => a.name === name)?.discriminator ?? []).toString("hex");
};
type Decode = (info: AccountInfo<Buffer>) => unknown;
type Spec = { owner: ProgramName; size: number | null; disc: string; decode: Decode };

// Sizes are exact: pump appending a field is a pause the owner reviews (Pitfall 9). BONDR's own accounts are
// checked for owner, discriminator and decode only, since its curve or pool was never measured on mainnet.
const SPECS: Record<string, Spec> = {
  Global: {
    owner: "pump",
    size: 1088,
    disc: disc(pumpIdl, "Global"),
    decode: (i) => PUMP_SDK.decodeGlobal(i),
  },
  FeeConfig: {
    ...{ owner: "pump fees", size: 4097, disc: disc(pumpIdl, "FeeConfig") },
    decode: (i) => PUMP_SDK.decodeFeeConfig(i),
  },
  "AMM GlobalConfig": {
    ...{ owner: "pump AMM", size: 949, disc: disc(pumpAmmJson, "GlobalConfig") },
    decode: (i) => PUMP_AMM_SDK.decodeGlobalConfig(i),
  },
  "AMM FeeConfig": {
    ...{ owner: "pump fees", size: 4097, disc: disc(pumpAmmJson, "FeeConfig") },
    decode: (i) => PUMP_AMM_SDK.decodeFeeConfig(i),
  },
  "BONDR bonding curve": {
    ...{ owner: "pump", size: null, disc: disc(pumpIdl, "BondingCurve") },
    decode: (i) => PUMP_SDK.decodeBondingCurve(i),
  },
  "BONDR pool": {
    ...{ owner: "pump AMM", size: null, disc: disc(pumpAmmJson, "Pool") },
    decode: (i) => PUMP_AMM_SDK.decodePool(i),
  },
};

// BONDR-quoted coins are pump coin quotes, so the exotic schedule applies; the program treats an
// all-zero exotic schedule as unset and charges the flat one instead.
export function effective(f: Facts, exotic: string, flat: string, field: string): number {
  const unset = ["lp", "protocol", "creator"].every((k) => !Number(f[`${exotic}.${k}`] ?? 0));
  return Number(f[`${unset ? flat : exotic}.${field}`]);
}

// The spike's drift strings (D-18): the spike records them as evidence, the worker pauses on them.
export function drift(f: Facts, p: Profile = MAINNET): string[] {
  const out: string[] = [];
  const curveProtocol = effective(f, "curveExotic", "curveFlat", "protocol");
  if (curveProtocol !== p.curveProtocol)
    out.push(`curve protocol ${curveProtocol} bps, assumed ${p.curveProtocol}`);
  const max = Number(f.maxConfigurableCreatorFeeBps);
  if (p.creatorFeeConfigurable && !f.creatorFeeConfigurable)
    out.push(`creator fee not configurable, assumed ${p.curveCreator} bps per coin`);
  else if (p.creatorFeeConfigurable && max < p.curveCreator)
    out.push(`max creator fee ${max} bps, below assumed ${p.curveCreator}`);
  const ammLp = effective(f, "ammExotic", "ammFlat", "lp");
  if (ammLp !== p.ammLp) out.push(`AMM LP ${ammLp} bps, assumed ${p.ammLp}`);
  const ammProtocol = effective(f, "ammExotic", "ammFlat", "protocol");
  if (ammProtocol !== p.ammProtocol) out.push(`AMM protocol ${ammProtocol} bps, assumed ${p.ammProtocol}`);
  if (Number(f.maxCurveDepth) < p.minCurveDepth)
    out.push(`maxCurveDepth ${f.maxCurveDepth}, need ${p.minCurveDepth}`);
  return out;
}

function accountFacts(a: AccountFact): string[] {
  const spec = SPECS[a.name] as Spec;
  if (a.owner !== IDS[spec.owner]) return [`${a.name} account not owned by the ${spec.owner} program`];
  const out: string[] = [];
  if (spec.size !== null && a.size !== spec.size)
    out.push(`${a.name} account is ${a.size} bytes, expected ${spec.size}`);
  if (a.disc !== spec.disc) out.push(`${a.name} discriminator changed`);
  else if (!a.decodes) out.push(`${a.name} no longer decodes with the pinned SDK`);
  return out;
}

/** Every failed fact in plain words; empty means BONDR's assumptions about pump still hold. */
export function judge(input: CheckInput, p: Profile): string[] {
  const out = new Set<string>();
  for (const prog of input.programs) {
    if (!prog.executable) out.add(`${prog.name} program missing or not executable`);
    else if (prog.owner !== LOADER) out.add(`${prog.name} program not owned by the upgradeable loader`);
  }
  for (const a of input.accounts) for (const f of accountFacts(a)) out.add(f);
  const f = input.config;
  if (!f) return [...out.add("live config no longer decodes with the pinned SDK")];
  if (!f.createV2Enabled) out.add("create_v2 disabled");
  for (const d of drift(f, p)) out.add(d);
  // D-19 checks the max on its own; drift reports it only when the fee is configurable.
  const max = Number(f.maxConfigurableCreatorFeeBps);
  if (p.creatorFeeConfigurable && max < p.curveCreator)
    out.add(`max creator fee ${max} bps, below assumed ${p.curveCreator}`);
  return [...out];
}

function observe(name: string, info: AccountInfo<Buffer> | null): AccountFact {
  if (!info) return { name, size: 0, owner: null, disc: "", decodes: false };
  let decodes = true;
  try {
    (SPECS[name] as Spec).decode(info);
  } catch {
    decodes = false;
  }
  const head = info.data.subarray(0, 8).toString("hex");
  return { name, size: info.data.length, owner: info.owner.toBase58(), disc: head, decodes };
}

// Upgradeable loader layout: Program = u32 tag + programdata address; ProgramData = u32 tag + u64 deploy slot.
async function programs(
  conn: Connection,
): Promise<{ facts: ProgramFact[]; slots: Record<ProgramName, string> }> {
  const infos = await conn.getMultipleAccountsInfo(PROGRAMS.map(([, id]) => id));
  const facts = PROGRAMS.map(([name], i) => {
    const info = infos[i];
    return { name, executable: !!info?.executable, owner: info?.owner.toBase58() ?? null };
  });
  const ok = infos.map((info) => (info?.executable && info.data.length >= 36 ? info : null));
  const pds = ok.flatMap((info) => (info ? [new PublicKey(info.data.subarray(4, 36))] : []));
  const heads = pds.length
    ? await conn.getMultipleAccountsInfo(pds, { dataSlice: { offset: 0, length: 45 } })
    : [];
  let h = 0;
  const slots = Object.fromEntries(
    PROGRAMS.map(([name], i) => [name, ok[i] ? String(heads[h++]?.data.readBigUInt64LE(4) ?? "") : ""]),
  ) as Record<ProgramName, string>;
  return { facts, slots };
}

// A decode throw is a fact about the chain, not an RPC failure.
function decoded(infos: (AccountInfo<Buffer> | null)[]): Facts | null {
  try {
    return configFacts([infos[0], infos[1], infos[3]]);
  } catch {
    return null;
  }
}

/** Reads the chain and judges it. Only an RPC throw propagates (the worker shows "Could not run" and pauses
 * nothing); a missing, re-owned or re-laid-out account is judged from the raw infos as a mismatch (CR-W-02). */
export async function checkContract(conn: Connection, net: Net, bondr?: PublicKey): Promise<CheckResult> {
  const names = ["Global", "FeeConfig", "AMM GlobalConfig", "AMM FeeConfig"];
  const keys = [GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, GLOBAL_CONFIG_PDA, PUMP_AMM_FEE_CONFIG_PDA];
  if (bondr) keys.push(bondingCurvePda(bondr), canonicalPumpPoolPdaWithQuote(bondr, NATIVE_MINT));
  const [prog, infos] = await Promise.all([programs(conn), conn.getMultipleAccountsInfo(keys)]);
  const accounts = names.map((n, i) => observe(n, infos[i] ?? null));
  // Once BONDR migrates, its canonical pool is the account BONDR trades against.
  if (bondr)
    accounts.push(
      infos[5] ? observe("BONDR pool", infos[5]) : observe("BONDR bonding curve", infos[4] ?? null),
    );
  const config = decoded(infos);
  return { facts: judge({ programs: prog.facts, accounts, config }, PROFILES[net]), slots: prog.slots };
}
