"use client";

import { Search, X } from "lucide-react";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { BASE58_KEY } from "@/lib/guard";
import { Button } from "./ui-button";
import { Input } from "./ui-field";

const DEBOUNCE_MS = 300;

/** The query a search box text stands for: trimmed, "" under 2 characters (too broad, UI-SPEC Search). */
const term = (text: string) => {
  const t = text.trim();
  return t.length < 2 ? "" : t;
};

/** Search text state: `run` gets each new query 300 ms after typing stops; `clear` runs "" at once. */
export function useSearch(initial: string, run: (q: string) => void) {
  const [text, setText] = useState(initial);
  const last = useRef(initial);
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const q = term(text);
    if (q === last.current) return;
    const timer = setTimeout(() => {
      last.current = q;
      latest.current(q);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  function clear() {
    setText("");
    if (!last.current) return;
    last.current = "";
    latest.current("");
  }
  return { text, setText, clear };
}

type BoxProps = { text: string; setText(t: string): void; clear(): void; ref: Ref<HTMLInputElement> };

/** The search input (LIST-05): Escape and the X clear it and keep focus in it; results are live, Enter does nothing. */
export function SearchBox({ text, setText, clear, ref }: BoxProps) {
  const id = useId();
  return (
    <div className="relative flex-[0_1_360px]">
      <label htmlFor={id}>
        <span className="sr-only">Search coins by name, symbol or mint</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <Input
          ref={ref}
          id={id}
          type="search"
          value={text}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search name, symbol or mint"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
            if (e.key === "Enter") e.preventDefault();
          }}
          className="rounded-full pr-12 pl-10 text-[13px] md:pr-10 md:text-[15px] [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground md:right-2 md:size-8"
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The sr-only result count, read politely after each search. */
export function MatchCount({ n }: { n: number | null }) {
  const text = n === null ? "" : n === 0 ? "No coins match" : n === 1 ? "1 coin matches" : `${n} coins match`;
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

/** No match, or a full mint that was not launched through BONDR. q is rendered as text, cut to 40 characters. */
export function SearchEmpty({ q, clear }: { q: string; clear(): void }) {
  const mint = BASE58_KEY.test(q);
  const shown = q.length > 40 ? `${q.slice(0, 40)}…` : q;
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-16">
      <h3 className="display text-[28px] leading-none">
        {mint ? (
          "No BONDR coin at this address"
        ) : (
          // The query keeps its case: the display face uppercases headings, and a mint prefix is case-sensitive.
          <>
            No BONDR coin matches "<span className="normal-case">{shown}</span>"
          </>
        )}
      </h3>
      <p className="mt-2 mb-6 text-muted-foreground">
        {mint
          ? "This mint was not launched through BONDR, so it is not listed here."
          : "Search looks at name, symbol and mint. Only coins launched on BONDR are listed."}
      </p>
      <Button onClick={clear}>Clear search</Button>
    </div>
  );
}
