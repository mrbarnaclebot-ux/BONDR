"use client";
// Phantom through Wallet Standard. Bytes in and out only: no Solana library in the browser (D-15).
import { getWallets } from "@wallet-standard/app";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type W = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
type Account = W["accounts"][number];
type Chain = `solana:${string}`;
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly Account[] }> };
type DisconnectFeature = { disconnect(): Promise<void> };
type EventsFeature = { on(event: "change", cb: () => void): () => void };
type SignFeature = {
  supportedTransactionVersions: readonly ("legacy" | 0)[];
  signTransaction(
    ...inputs: { account: Account; transaction: Uint8Array; chain?: string }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type SignMessageFeature = {
  signMessage(
    ...inputs: { account: Account; message: Uint8Array }[]
  ): Promise<readonly { signature: Uint8Array }[]>;
};
type PhantomInjected = { on?(e: string, cb: () => void): void; off?(e: string, cb: () => void): void };

/** "loading" covers hydration and the grace period, so the control never flashes "not installed". */
export type WalletStatus = "loading" | "idle" | "connecting" | "connected" | "missing";

export type WalletApi = {
  status: WalletStatus;
  address: string | null;
  /** This browser holds a consent session for the address; null while the session is being read. */
  consented: boolean | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** solana:signTransaction only, never signAndSend: the worker adds the mint signature after Phantom. */
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
  /** solana:signMessage, used once at consent; the signature proves the wallet to the server. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Fires when Phantom switches from one connected account to another. Returns the unsubscribe. */
  onAccountChange(cb: (address: string) => void): () => void;
  markConsented(): void;
  /** The server has no session for this wallet (consent_required): the prompt opens again. */
  forgetConsent(): void;
};

const GRACE_MS = 600; // Phantom can register a moment after first render
const feature = <T,>(w: W, name: `${string}:${string}`) => w.features[name] as T | undefined;
const pick = (accounts: readonly Account[], chain: Chain) =>
  accounts.find((a) => a.chains.includes(chain)) ?? accounts[0] ?? null;

// D-08: Phantom is the only wallet; anything else announcing itself through Wallet Standard is ignored.
export const isPhantom = (w: W, chain: Chain): boolean => {
  const sign = feature<SignFeature>(w, "solana:signTransaction");
  return (
    w.name === "Phantom" &&
    !!sign &&
    sign.supportedTransactionVersions.includes(0) &&
    w.chains.includes(chain) &&
    !!w.features["standard:connect"]
  );
};

/** The user closing or refusing Phantom (agencybook): callers treat it as a quiet cancel, not an error. */
export const rejected = (e: unknown): boolean =>
  (e as { code?: unknown })?.code === 4001 ||
  /reject|cancel|declin|denied/i.test(String((e as Error)?.message ?? e));

// The session cookie names the wallet that signed consent. Reading it sends nothing about the wallet, so
// nothing about it reaches the server before Accept (PLAT-02). undefined: not read yet.
function useSession(address: string | null) {
  const [session, setSession] = useState<string | null>();
  useEffect(() => {
    if (!address || session !== undefined) return;
    fetch("/api/consent", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ wallet: string | null }>) : null))
      .then(
        (b) => setSession(b?.wallet ?? null),
        () => setSession(null),
      );
  }, [address, session]);
  return [session, setSession] as const;
}

function usePhantom(chain: Chain): { wallet: W | undefined; graceOver: boolean } {
  const [wallet, setWallet] = useState<W>();
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const ws = getWallets();
    const update = () => setWallet(ws.get().find((w) => isPhantom(w, chain)));
    update();
    const offs = [ws.on("register", update), ws.on("unregister", update)];
    const timer = setTimeout(() => setGraceOver(true), GRACE_MS);
    return () => {
      clearTimeout(timer);
      for (const off of offs) off();
    };
  }, [chain]);
  return { wallet, graceOver };
}

/** Follows Phantom's account: standard:events change, plus window.phantom accountChanged (A1 fallback). */
function useAccountSync(
  wallet: W | undefined,
  chain: Chain,
  connected: boolean,
  set: (a: Account | null) => void,
) {
  useEffect(() => {
    if (!wallet || !connected) return;
    const sync = () => set(pick(wallet.accounts, chain));
    const off = feature<EventsFeature>(wallet, "standard:events")?.on("change", sync);
    const injected = (window as { phantom?: { solana?: PhantomInjected } }).phantom?.solana;
    injected?.on?.("accountChanged", sync);
    return () => {
      off?.();
      injected?.off?.("accountChanged", sync);
    };
  }, [wallet, chain, connected, set]);
}

function useAccountListeners(address: string | null) {
  const listeners = useRef(new Set<(address: string) => void>());
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = address;
    if (before && address && before !== address) for (const cb of listeners.current) cb(address);
  }, [address]);
  return useCallback((cb: (address: string) => void) => {
    listeners.current.add(cb);
    return () => void listeners.current.delete(cb);
  }, []);
}

function useConnection(wallet: W | undefined, chain: Chain) {
  const [account, setAccount] = useState<Account | null>(null);
  const [connecting, setConnecting] = useState(false);
  const tried = useRef(false);
  const keepSame = useCallback(
    (next: Account | null) => setAccount((cur) => (next?.address === cur?.address ? cur : next)),
    [],
  );
  useAccountSync(wallet, chain, account !== null, keepSame);
  useEffect(() => {
    if (!wallet || tried.current) return;
    tried.current = true; // one silent attempt per page load, so Disconnect is not undone
    feature<ConnectFeature>(wallet, "standard:connect")
      ?.connect({ silent: true })
      .then(({ accounts }) => setAccount((cur) => cur ?? pick(accounts, chain)))
      .catch(() => {}); // not trusted yet: stay disconnected
  }, [wallet, chain]);
  return { account, setAccount: keepSame, connecting, setConnecting };
}

function useWalletApi(chain: Chain): WalletApi {
  const { wallet, graceOver } = usePhantom(chain);
  const { account, setAccount, connecting, setConnecting } = useConnection(wallet, chain);
  const address = account?.address ?? null;
  const [session, setSession] = useSession(address);
  const onAccountChange = useAccountListeners(address);
  const status: WalletStatus = account
    ? "connected"
    : connecting
      ? "connecting"
      : wallet
        ? "idle"
        : graceOver
          ? "missing"
          : "loading";
  let consented: boolean | null = address !== null && session === address;
  if (address && session === undefined) consented = null; // still reading: no prompt flash for a returning wallet
  return {
    status,
    address,
    consented,
    connect: () => connectTo(wallet, chain, setAccount, setConnecting),
    disconnect: async () => {
      setAccount(null);
      if (wallet)
        await feature<DisconnectFeature>(wallet, "standard:disconnect")
          ?.disconnect()
          .catch(() => {});
    },
    signTransaction: (bytes) => sign(wallet, account, chain, bytes),
    signMessage: (bytes) => signMessage(wallet, account, bytes),
    onAccountChange,
    markConsented: () => setSession(address),
    forgetConsent: () => setSession(null),
  };
}

async function connectTo(
  wallet: W | undefined,
  chain: Chain,
  setAccount: (a: Account | null) => void,
  setConnecting: (busy: boolean) => void,
): Promise<void> {
  const connect = wallet && feature<ConnectFeature>(wallet, "standard:connect");
  if (!connect) return;
  setConnecting(true);
  try {
    setAccount(pick((await connect.connect()).accounts, chain));
  } catch (e) {
    // UI-SPEC: closing Phantom returns to Disconnected with no message; anything else is worth a log.
    if (!rejected(e)) console.error("Phantom connect failed", (e as Error)?.name);
  } finally {
    setConnecting(false);
  }
}

async function sign(wallet: W | undefined, account: Account | null, chain: Chain, transaction: Uint8Array) {
  const signer = wallet && feature<SignFeature>(wallet, "solana:signTransaction");
  if (!signer || !account) throw new Error("Phantom is not connected");
  const [out] = await signer.signTransaction({ account, transaction, chain });
  if (!out) throw new Error("Phantom returned no signed transaction");
  return out.signedTransaction;
}

async function signMessage(wallet: W | undefined, account: Account | null, message: Uint8Array) {
  const signer = wallet && feature<SignMessageFeature>(wallet, "solana:signMessage");
  if (!signer || !account) throw new Error("Phantom cannot sign messages");
  const [out] = await signer.signMessage({ account, message });
  if (!out) throw new Error("Phantom returned no signature");
  return out.signature;
}

const WalletContext = createContext<WalletApi | null>(null);

export function WalletProvider({ net, children }: { net?: string; children: ReactNode }) {
  // Phase 2 runs on devnet only; mainnet arrives with its own gate in Phase 7.
  const chain: Chain = net === "mainnet" ? "solana:mainnet" : "solana:devnet";
  return <WalletContext value={useWalletApi(chain)}>{children}</WalletContext>;
}

export function useWallet(): WalletApi {
  const api = useContext(WalletContext);
  if (!api) throw new Error("useWallet needs WalletProvider");
  return api;
}
