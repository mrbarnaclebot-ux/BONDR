"use client";
// The trade panel's wallet balances (D-16), split from use-trade.ts to keep both files short.
import type { TradeBalance } from "@bondr/core/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/wallet";

/** The wallet's balances (D-16): unknown without a consented wallet. */
export type BalanceState = TradeBalance | "unknown" | "loading" | "failed";

/**
 * D-16: the session wallet's balances, fetched when a consented wallet connects, when the tab comes back and on
 * refreshBalance. Never on a timer. A refetch keeps the shown value until the new one lands.
 */
export function useBalance(mint: string) {
  const w = useWallet();
  const address = w.status === "connected" && w.consented ? w.address : null;
  const [balance, setBalance] = useState<BalanceState>("unknown");
  const reload = useRef(() => {});
  useEffect(() => {
    setBalance(address ? "loading" : "unknown");
    if (!address) return;
    let seq = 0;
    const load = () => {
      const id = ++seq;
      fetch("/api/trade/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<TradeBalance>) : Promise.reject(r.status)))
        .then(
          (b) => id === seq && setBalance(b),
          () => id === seq && setBalance("failed"),
        );
    };
    const onShow = () => document.visibilityState === "visible" && load();
    reload.current = load;
    load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      seq = -1; // a late answer for the old wallet is dropped
      reload.current = () => {};
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [address, mint]);
  return { balance, refreshBalance: useCallback(() => reload.current(), []) };
}
