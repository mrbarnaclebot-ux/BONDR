"use client";

import type { CoinRow } from "@bondr/core/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { BASE58_KEY } from "@/lib/guard";
import type { Sort } from "@/lib/live-list";
import { Callout } from "./callout";
import { CoinCard } from "./coin-card";
import { type CoinPage, useHome } from "./home-live";
import { MatchCount, SearchBox, SearchEmpty, useSearch } from "./home-search";
import { Button, buttonVariants } from "./ui-button";
import { Seg } from "./ui-seg";

const LABELS = { top: "Top", latest: "Latest", oldest: "Oldest" } as const;
const OPTIONS = Object.values(LABELS);

async function fetchPage(sort: Sort, page: number, q: string, signal: AbortSignal): Promise<CoinPage> {
  const res = await fetch(`/api/coins?${new URLSearchParams({ sort, page: String(page), q })}`, { signal });
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

/** Sort and search live in the URL by replaceState (Back leaves the page); top and no search are omitted. */
function syncUrl(sort: Sort, q: string) {
  const p = new URLSearchParams();
  if (sort !== "top") p.set("sort", sort);
  if (q) p.set("q", q);
  window.history.replaceState(null, "", p.size ? `?${p}` : location.pathname);
}

/** The list (held by HomeLiveProvider): page 0 of a sort replaces it, a later page appends; a newer load aborts the last. */
function useCoinList() {
  const [list, setList] = useHome().list;
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState<Busy>(null);
  const ctl = useRef<AbortController>(null);

  async function load(sort: Sort, page: number, q: string): Promise<CoinPage | null> {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(page ? "more" : "swap");
    try {
      const got = await fetchPage(sort, page, q, c.signal);
      if (c.signal.aborted) return null;
      setList((old) => (page && old ? append(old, got) : got));
      setPages(page + 1);
      setBusy(null);
      return got;
    } catch {
      if (c.signal.aborted) return null;
      setList(null); // UI-SPEC Home states: the error replaces the grid
    }
    setBusy(null);
    return null;
  }
  return { list, pages, busy, load };
}

function Grid({ coins, busy }: { coins: CoinRow[]; busy: boolean }) {
  return (
    <ol
      {...useHome().hold}
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
 * All coins (LIST-02, LIST-03, LIST-05): Top / Latest / Oldest and search, 50 cards a page with Show more. A tab
 * switch or search keeps the old cards at 60% with aria-busy until the new page arrives. A full BONDR mint opens
 * its coin. The list, sort and search live in HomeLiveProvider (null list: the read failed), so live events see
 * them: a new launch is inserted only into Latest with no search.
 */
export function HomeCoins() {
  const router = useRouter();
  const live = useHome();
  const [sort, setSort] = live.sort;
  const [q, setQ] = live.q;
  const input = useRef<HTMLInputElement>(null);
  const { list, pages, busy, load } = useCoinList();
  const search = useSearch(q, find);

  async function find(next: string) {
    setQ(next);
    syncUrl(sort, next);
    const got = await load(sort, 0, next);
    if (BASE58_KEY.test(next) && got?.coins.some((c) => c.mint === next)) router.push(`/coin/${next}`);
  }

  function clear() {
    search.clear();
    input.current?.focus();
  }

  function pick(label: string) {
    const next = label.toLowerCase() as Sort;
    if (next === sort && list) return;
    setSort(next);
    syncUrl(next, q);
    void load(next, 0, q);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 max-[560px]:*:w-full">
        <Seg label="Sort coins" options={OPTIONS} value={LABELS[sort]} onChange={pick} />
        <SearchBox {...search} clear={clear} ref={input} />
      </div>
      <MatchCount n={q && list && busy === null ? list.coins.length : null} />
      {!list ? (
        <Failed retry={() => void load(sort, 0, q)} busy={busy !== null} />
      ) : list.coins.length === 0 ? (
        q ? (
          <SearchEmpty q={q} clear={clear} />
        ) : (
          <Empty />
        )
      ) : (
        <Grid coins={list.coins} busy={busy === "swap"} />
      )}
      {list?.more && (
        <div className="mt-6 flex justify-center">
          <Button
            className="max-[560px]:w-full"
            disabled={busy !== null}
            onClick={() => void load(sort, pages, q)}
          >
            {busy === "more" ? "Loading…" : "Show more coins"}
          </Button>
        </div>
      )}
    </>
  );
}
