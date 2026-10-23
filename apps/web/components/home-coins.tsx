"use client";

import type { CoinRow } from "@bondr/core/api";
import Link from "next/link";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Callout } from "./callout";
import { CoinCard } from "./coin-card";
import { Button, buttonVariants } from "./ui-button";
import { Seg } from "./ui-seg";

const LABELS = { top: "Top", latest: "Latest", oldest: "Oldest" } as const;
const OPTIONS = Object.values(LABELS);
export type Sort = keyof typeof LABELS;
export type CoinPage = { coins: CoinRow[]; more: boolean };

async function fetchPage(sort: Sort, page: number, signal: AbortSignal): Promise<CoinPage> {
  const res = await fetch(`/api/coins?sort=${sort}&page=${page}`, { signal });
  if (!res.ok) throw new Error(`coins ${res.status}`);
  return res.json();
}

/** Appends the next page, dropping any coin a re-sort already showed. */
function append(old: CoinPage, next: CoinPage): CoinPage {
  const seen = new Set(old.coins.map((c) => c.mint));
  return { coins: [...old.coins, ...next.coins.filter((c) => !seen.has(c.mint))], more: next.more };
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-16">
      <h3 className="display text-[28px] leading-none">No coins yet</h3>
      <p className="mt-2 mb-6 text-muted-foreground">
        Coins launched on BONDR show up here the moment they land.
      </p>
      <Link href="/launch" className={buttonVariants({ variant: "primary", size: "lg" })}>
        Launch a coin
      </Link>
    </div>
  );
}

function Failed({ retry, busy }: { retry(): void; busy: boolean }) {
  return (
    <Callout variant="error">
      Could not load coins. Check your connection, then try again.
      <Button className="mt-3 flex" onClick={retry} disabled={busy}>
        Try again
      </Button>
    </Callout>
  );
}

type Busy = "swap" | "more" | null;

/** The list state: page 0 of a sort replaces the list, a later page appends; a newer load aborts the last. */
function useCoinList(initial: CoinPage | null) {
  const [list, setList] = useState(initial);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState<Busy>(null);
  const ctl = useRef<AbortController>(null);

  async function load(sort: Sort, page: number) {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(page ? "more" : "swap");
    try {
      const got = await fetchPage(sort, page, c.signal);
      if (c.signal.aborted) return;
      setList((old) => (page && old ? append(old, got) : got));
      setPages(page + 1);
    } catch {
      if (c.signal.aborted) return;
      setList(null); // UI-SPEC Home states: the error replaces the grid
    }
    setBusy(null);
  }
  return { list, pages, busy, load };
}

function Grid({ coins, busy }: { coins: CoinRow[]; busy: boolean }) {
  return (
    <ol
      aria-label="Coins"
      aria-busy={busy}
      className={cn(
        "m-0 grid list-none grid-cols-1 gap-4 p-0 transition-opacity min-[560px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-5",
        busy && "opacity-60",
      )}
    >
      {coins.map((c) => (
        <li key={c.mint} className="flex">
          <CoinCard coin={c} />
        </li>
      ))}
    </ol>
  );
}

/**
 * All coins (LIST-02, LIST-03): Top / Latest / Oldest, 50 cards a page with Show more. A tab switch keeps the
 * old cards at 60% with aria-busy until the new page arrives; the sort lives in ?sort= by replaceState, so Back
 * leaves the page. `initial` is the server render; null when that read failed.
 */
export function HomeCoins({ initial, sort: first }: { initial: CoinPage | null; sort: Sort }) {
  const [sort, setSort] = useState(first);
  const { list, pages, busy, load } = useCoinList(initial);

  function pick(label: string) {
    const next = label.toLowerCase() as Sort;
    if (next === sort && list) return;
    setSort(next);
    window.history.replaceState(null, "", next === "top" ? location.pathname : `?sort=${next}`);
    void load(next, 0);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 max-[560px]:*:w-full">
        <Seg label="Sort coins" options={OPTIONS} value={LABELS[sort]} onChange={pick} />
      </div>
      {!list ? (
        <Failed retry={() => void load(sort, 0)} busy={busy !== null} />
      ) : list.coins.length === 0 ? (
        <Empty />
      ) : (
        <Grid coins={list.coins} busy={busy === "swap"} />
      )}
      {list?.more && (
        <div className="mt-6 flex justify-center">
          <Button
            className="max-[560px]:w-full"
            disabled={busy !== null}
            onClick={() => void load(sort, pages)}
          >
            {busy === "more" ? "Loading…" : "Show more coins"}
          </Button>
        </div>
      )}
    </>
  );
}
