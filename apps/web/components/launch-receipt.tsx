"use client";
import { parseSol } from "@bondr/core/rules";
import type { ReactNode } from "react";
import { pct, short, sol } from "@/lib/format";
import { EXIT_NAME } from "./launch-buy";
import type { Launch, Live } from "./launch-flow";

type Row = [string, ReactNode];

const ASIDE =
  "relative rounded-b-lg p-6 pt-[30px] shadow-elev-2 min-[1080px]:sticky min-[1080px]:top-[88px] " +
  "bg-[radial-gradient(100%_40%_at_50%_0%,color-mix(in_oklch,var(--leaf)_9%,transparent),transparent_70%),linear-gradient(180deg,var(--surface-2),var(--surface))] " +
  // perforated top edge: background-colored half circles punched along the top
  "before:absolute before:inset-x-0 before:-top-px before:h-2 before:content-[''] before:bg-repeat-x before:bg-size-[12px_8px] " +
  "before:bg-[radial-gradient(circle_at_6px_-1px,var(--background)_5px,transparent_5.5px)]";

const Up = ({ children }: { children: ReactNode }) => <span className="text-leaf">{children}</span>;

// The split is fixed by the program design, not read from chain, so these two groups are static.
const BEFORE_BOND: Row[] = [
  ["Burn budget for this coin", "90%"],
  ["BONDR treasury", "10%"],
  ["You", "0%"],
];
const AFTER_BOND: Row[] = [
  ["You, permanently", <Up key="you">80%</Up>],
  ["BONDR treasury", "20%"],
];

const GENESIS_FEE: Row[] = [["BONDR treasury, claimed on pump.fun", "100%"]];

/** Updates on every keystroke from the flow state; every fee and cost is live (D-01), never a constant. */
export function LaunchReceipt({ state, live }: { state: Launch; live: Live }) {
  const s = live.status;
  // "…" while the first status is loading; "Unavailable" once the chain read is known to have failed.
  const gap =
    s === null && !live.statusError ? (
      "…"
    ) : (
      <span className="font-sans text-muted-foreground">Unavailable</span>
    );
  const cost = (v: string | null | undefined) => (v ? `about ${sol(v, 4, true)} SOL` : gap);
  const parsed = parseSol(state.devBuy);
  const buy = parsed.ok ? `${sol(parsed.value)} SOL` : "–";
  const launch: Row[] = [
    ["Mint, reserved", state.mint ? short(state.mint) : "…bndr, at signing"],
    ...(live.genesis ? [["Pair", "SOL"] as Row] : []),
    ["Dev buy", buy],
    ["Exit", state.exit ? EXIT_NAME[state.exit] : "Not chosen"],
    ["Launch supply you hold", <Up key="held">0</Up>],
  ];
  const trade: Row[] = [
    ["Pump protocol", s?.fees ? pct(s.fees.protocolBps) : gap],
    ["Creator fee", s?.fees ? pct(s.fees.creatorBps) : gap],
    ["BONDR platform fee", <Up key="platform">0</Up>],
  ];
  const now: Row[] = [
    ["Dev buy", buy],
    ["Pump create and accounts", cost(s?.createCostEstimate)],
    ["Network fee", cost(s?.networkFeeEstimate)],
    // Mainnet only (D-34): shown while loading or unreadable, hidden once a loaded status says there is none.
    ...(s === null || s.senderTipEstimate !== null
      ? [["Sender tip", cost(s?.senderTipEstimate)] as Row]
      : []),
    ["Back to you on insta sell", back(state, live)],
  ];
  return (
    <aside aria-label="Launch summary" className={ASIDE}>
      <Head state={state} />
      <Group rows={launch} />
      <Group title="Every curve trade" rows={trade} />
      {live.genesis ? (
        // D-31: BONDR is not a BONDR-quoted child, so no W, split, sweep or finalize applies.
        <Group title="Creator fee" rows={GENESIS_FEE} />
      ) : (
        <>
          <Group title="Creator fee, before bond" rows={BEFORE_BOND} />
          <Group title="Creator fee, after bond" rows={AFTER_BOND} />
        </>
      )}
      <Group title="You pay now" rows={now} />
    </aside>
  );
}

function back(state: Launch, live: Live): string {
  if (state.exit === "burn") return "none, burned";
  if (state.exit !== "sell") return "–";
  const q = live.quote.quote;
  return `about ${q ? sol(q.solBackEstimate, 3) : "…"} SOL`;
}

function Head({ state }: { state: Launch }) {
  const name = state.fields.name.trim() || "Your coin";
  const symbol = state.fields.symbol.trim().toUpperCase() || "SYMBOL";
  return (
    <div className="flex items-center gap-3 border-b border-dashed border-line-strong pb-4">
      {state.image ? (
        <img
          src={state.image.url}
          alt=""
          className="size-[52px] flex-none rounded-[10px] object-cover ring-1 ring-line"
        />
      ) : (
        <span className="size-[52px] flex-none rounded-[10px] border border-dashed border-line-strong" />
      )}
      <div className="min-w-0">
        <b className="display block text-[1.75rem] leading-none [overflow-wrap:anywhere]">{name}</b>
        <span className="num text-sm text-muted-foreground">{symbol}</span>
      </div>
    </div>
  );
}

function Group({ title, rows }: { title?: string; rows: Row[] }) {
  return (
    <div className="grid gap-2 border-b border-dashed border-line-strong py-4 text-xs last:border-b-0 last:pb-0">
      {title && (
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
      )}
      <dl className="m-0 grid gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="num m-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
