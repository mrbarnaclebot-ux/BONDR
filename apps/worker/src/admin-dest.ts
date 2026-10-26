// The destination lock (D-14): every top-level outflow an admin job builds must go to burn, the treasury, the
// buyback, that coin's deployer or the coin's own W accounts. Pure: no RPC, no env.
// ponytail: the check covers BONDR-authored top-level transfers. CPI recipients inside the pump programs are
// trusted through signTx's ALLOWED_PROGRAMS (which also refuses any unknown program at signing, so other
// programs pass here). Upgrade path: diff every writable account in the simulation against the allowlist.
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInstruction,
} from "@solana/spl-token";
import {
  type PublicKey,
  SystemInstruction,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

// Address to display name ("Treasury", "Deployer 7xKX...", "W 9fQ2...").
export type Allowed = {
  owners: Map<string, string>;
  atas: Map<string, string>;
  closeTo: string;
  mints: string[];
  recorded?: true; // WR-W-03: the deployer is the recorded launch wallet, not proven against the launch signer
};
type Who = {
  treasury?: PublicKey;
  buyback?: PublicKey;
  deployer?: PublicKey;
  internal: PublicKey[];
  mints: PublicKey[];
  closeTo: PublicKey;
  recorded?: true;
};

export const short = (k: PublicKey) => `${k.toBase58().slice(0, 4)}...`;
const PROGRAMS = [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID];

export function allowFor(w: Who): Allowed {
  const named: [PublicKey, string][] = [];
  if (w.treasury) named.push([w.treasury, "Treasury"]);
  if (w.buyback) named.push([w.buyback, "Buyback"]);
  if (w.deployer) named.push([w.deployer, `Deployer ${short(w.deployer)}`]);
  for (const k of w.internal) named.push([k, `W ${short(k)}`]);
  const atas = new Map<string, string>();
  for (const [owner, name] of named)
    for (const mint of w.mints)
      for (const p of PROGRAMS)
        atas.set(getAssociatedTokenAddressSync(mint, owner, true, p).toBase58(), name);
  const owners = new Map(named.map(([k, n]) => [k.toBase58(), n]));
  const mints = w.mints.map((m) => m.toBase58());
  return { owners, atas, closeTo: w.closeTo.toBase58(), mints, ...(w.recorded && { recorded: true }) };
}

function systemRecipient(ix: TransactionInstruction): PublicKey | null {
  try {
    const type = SystemInstruction.decodeInstructionType(ix);
    if (type === "Transfer") return ix.keys[1].pubkey;
    if (type === "TransferWithSeed") return ix.keys[2].pubkey;
  } catch {
    // Not a decodable system instruction: the runtime rejects it anyway.
  }
  return null;
}

// Jobs only transfer, burn and close; any other token instruction (Approve, SetAuthority, an undecodable
// extension) could hand the account away, so it is refused, naming the account it touches.
function tokenRefusal(ix: TransactionInstruction, a: Allowed): string | null {
  let d: ReturnType<typeof decodeInstruction>;
  try {
    d = decodeInstruction(ix, ix.programId);
  } catch {
    return ix.keys[0]?.pubkey.toBase58() ?? ix.programId.toBase58();
  }
  const kind = d.data.instruction;
  if (kind === TokenInstruction.Burn || kind === TokenInstruction.BurnChecked) return null;
  if (kind === TokenInstruction.Transfer || kind === TokenInstruction.TransferChecked) {
    const to = ix.keys[kind === TokenInstruction.Transfer ? 1 : 2].pubkey.toBase58();
    return a.atas.has(to) ? null : to;
  }
  if (kind === TokenInstruction.CloseAccount) {
    const to = ix.keys[1].pubkey.toBase58();
    return to === a.closeTo ? null : to;
  }
  return ix.keys[0].pubkey.toBase58();
}

// The first refused recipient's address, or null when every outflow is allowed (send.ts checkMessage shape).
export function refusedDestination(ixs: TransactionInstruction[], a: Allowed): string | null {
  for (const ix of ixs) {
    const p = ix.programId;
    if (p.equals(SystemProgram.programId)) {
      const to = systemRecipient(ix)?.toBase58();
      if (to && !a.owners.has(to)) return to;
    } else if (PROGRAMS.some((t) => t.equals(p))) {
      const refused = tokenRefusal(ix, a);
      if (refused) return refused;
    } else if (p.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.data.length > 0 && ix.data[0] > 1) {
      return ix.keys[2]?.pubkey.toBase58() ?? p.toBase58(); // RecoverNested moves tokens; jobs never use it
    }
  }
  return null;
}

const linesOf = (a: Allowed): [string, string][] => [
  ["Deployer ", a.recorded ? "deployer is the recorded launch wallet" : "deployer matches the launch signer"],
  ["Treasury", "treasury matches config"],
  ["Buyback", "buyback matches config"],
];

// For "Destinations check passed: ...". The coin's own W is an internal move, not a destination worth naming.
export function passedLines(a: Allowed): string[] {
  const names = [...a.owners.values()];
  const out = linesOf(a)
    .filter(([prefix]) => names.some((n) => n.startsWith(prefix)))
    .map(([, line]) => line);
  return out.length ? out : ["burn only"];
}
