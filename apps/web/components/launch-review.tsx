"use client";
import { normalizeLink } from "@bondr/core/rules";
import { Flame, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { compact, pct, short, sol } from "@/lib/format";
import { Callout } from "./callout";
import { EXIT_NAME } from "./launch-buy";
import type { Fields, Live, StepProps } from "./launch-flow";
import { Button } from "./ui-button";
import { useWallet } from "./wallet";

const CREATOR =
  "A fee wallet for this coin only. It can force the bond, burn, sweep to the BONDR buyback, or pay you after bond. Nothing else.";
const icon = <Wallet strokeWidth={1.5} aria-hidden="true" />;

// Raw link text may never have been blurred, so it is normalized again here (02-07 note).
function links(f: Fields): string {
  const list = (["x", "telegram", "website"] as const).flatMap((k) => {
    const r = normalizeLink(k, f[k]);
    return r.ok && r.value ? [r.value.replace(/^https:\/\//, "")] : [];
  });
  return list.join(", ") || "None";
}

type Row = [string, ReactNode];

function rows({ state, live }: StepProps): Row[] {
  const f = state.fields;
  const symbol = f.symbol.trim().toUpperCase();
  const q = live.quote.quote;
  const coin: Row = ["Coin", `${f.name.trim()} (${symbol})`];
  const buy: Row = [
    "Dev buy",
    <>
      <span className="num">{live.buy.ok ? sol(live.buy.lamports) : "…"} SOL</span>, about{" "}
      {q ? compact(q.tokensOut) : "…"} {symbol}
    </>,
  ];
  if (live.genesis) return genesisRows(coin, buy, f, live.status?.genesisTreasury);
  return [
    coin,
    ["Mint", "Assigned when you sign, ends in bndr"],
    ["Image and metadata", "Pinned to IPFS when you sign"],
    ["Links", links(f)],
    buy,
    ["Exit", state.exit ? `${EXIT_NAME[state.exit]}, in the same transaction` : "Not chosen"],
    ["Creator of record", CREATOR],
    ["You after bond", "80% of the creator fee, permanently"],
  ];
}

// UI-SPEC surface 2: BONDR itself is a SOL coin whose creator is the treasury (D-28, D-31).
function genesisRows(coin: Row, buy: Row, f: Fields, treasury?: string): Row[] {
  const who = treasury ? `The BONDR treasury ${short(treasury)}.` : "The BONDR treasury.";
  return [
    coin,
    ["Pair", "SOL"],
    ["Mint", "Assigned when you sign, ends in bndr"],
    ["Image and metadata", "Pinned to IPFS when you sign"],
    ["Links", links(f)],
    buy,
    ["Exit", "Insta burn, in the same transaction"],
    ["Creator of record", `${who} Its creator fees are claimed on pump.fun by the owner.`],
  ];
}

export function LaunchReview(props: StepProps) {
  const { dispatch, live } = props;
  const fees = live.status?.fees;
  const feeFailed = !fees && (live.status !== null || live.statusError);
  return (
    <div className="grid gap-6">
      <dl className="grid">
        {rows(props).map(([k, v]) => (
          <div
            key={k}
            className="grid gap-1 border-b border-line py-3 text-sm sm:grid-cols-[180px_1fr] sm:gap-4"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
      {/* D-31: BONDR's own creator fee has no split; the summary's one "Creator fee" group says where it goes. */}
      {!live.genesis && <FeeCallout creatorBps={fees?.creatorBps} />}
      {feeFailed && (
        <Callout variant="error">
          Could not read pump's fee settings, so launching is off for now. Reload the page in a minute.
        </Callout>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button type="button" onClick={() => dispatch({ type: "go", step: 2 })}>
          Back
        </Button>
        <SignButton live={live} onSign={() => dispatch({ type: "go", step: 4 })} />
      </div>
    </div>
  );
}

function FeeCallout({ creatorBps }: { creatorBps?: number }) {
  const title = `Where the ${creatorBps === undefined ? "" : `${pct(creatorBps, true)} `}creator fee goes`;
  return (
    <Callout icon={Flame} title={title}>
      <ul className="mt-1.5 grid list-disc gap-1 pl-[1.1em]">
        <li>
          <b>Before bond:</b> 90% builds a burn budget, 10% to the BONDR treasury.
        </li>
        <li>
          <b>At 105% of the cost to finish the curve:</b> the budget buys the rest and burns it.
        </li>
        <li>
          <b>After bond:</b> 80% to you, 20% to the treasury, permanently.
        </li>
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">
        No bond within 24 hours? That window's budget buys and burns BONDR instead.
      </p>
    </Callout>
  );
}

// A pause outranks the wallet: there is nothing to connect for while launches are off.
function SignButton({ live, onSign }: { live: Live; onSign(): void }) {
  const { status, consented, connect } = useWallet();
  const props = { type: "button", variant: "primary", size: "lg", className: "max-sm:flex-1" } as const;
  if (live.status?.paused)
    return (
      <Button {...props} disabled>
        Launches paused
      </Button>
    );
  // Connected without consent means the consent dialog is already open; Accept lands back here.
  if (status !== "connected" || !consented)
    return (
      <Button {...props} disabled={status !== "idle"} onClick={() => connect()}>
        {icon}
        Connect Phantom to launch
      </Button>
    );
  return (
    <Button {...props} disabled={!live.status?.fees} onClick={onSign}>
      {icon}
      Sign in Phantom
    </Button>
  );
}
