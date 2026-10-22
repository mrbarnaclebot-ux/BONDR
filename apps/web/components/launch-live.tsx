"use client";
import type { LaunchView } from "@bondr/core/api";
import Image from "next/image";
import Link from "next/link";
import { type Dispatch, useEffect } from "react";
import { compact, sol } from "@/lib/format";
import { getView } from "@/lib/launch-run";
import { CaRow } from "./ca-row";
import type { Action, StepProps } from "./launch-flow";
import { stored } from "./launch-sign";
import { ProofStamp } from "./proof-stamp";
import { Button } from "./ui-button";

const FACT_POLLS = 30;

// Landed is written at confirmation and the facts follow from the fetched tx a moment later (02-12).
function useFacts(v: LaunchView, dispatch: Dispatch<Action>) {
  useEffect(() => {
    if (v.facts) return;
    let n = 0;
    // A read still in flight after "Launch another" must not take the user back to the old coin (web WR-06).
    let live = true;
    const timer = setInterval(async () => {
      if (++n >= FACT_POLLS) clearInterval(timer);
      const next = await getView(v.id);
      if (live && next && next !== "not_found" && next.facts) dispatch({ type: "live", view: next });
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [v.id, v.facts, dispatch]);
}

function sentence(v: LaunchView): string {
  const tokens = v.facts?.tokens ? ` (${compact(v.facts.tokens)} tokens)` : "";
  const head = `Your ${sol(v.solIn)} SOL dev buy${tokens} was`;
  if (v.exit === "burn") return `${head} burned in the launch transaction.`;
  const back = v.facts?.solBack ? ` You got back ${sol(v.facts.solBack, 4)} SOL.` : "";
  return `${head} sold back in the launch transaction.${back}`;
}

function Art({ image }: { image: string | null }) {
  return (
    <div aria-hidden="true" className="relative grid h-[220px] place-items-center overflow-hidden rounded-md">
      <Image
        src="/art/hero-bond-960.jpg"
        alt=""
        fill
        priority
        sizes="(min-width: 1080px) 880px, 100vw"
        className="object-cover object-[60%_50%]"
      />
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,transparent_35%,color-mix(in_oklch,var(--ink)_70%,transparent))]" />
      <div className="relative grid place-items-center">
        {["0s", "0.9s", "1.8s"].map((delay) => (
          <i
            key={delay}
            style={{ animationDelay: delay }}
            className="absolute size-[84px] animate-orb rounded-[26px] border-[1.5px] border-leaf opacity-0 motion-reduce:hidden"
          />
        ))}
        <span className="relative size-[84px] overflow-hidden rounded-[22px] bg-surface shadow-[0_0_0_2px_var(--leaf),0_0_40px_color-mix(in_oklch,var(--leaf)_70%,transparent)]">
          {image && <Image src={image} alt="" fill unoptimized className="object-cover" />}
        </span>
      </div>
    </div>
  );
}

/** Step 5: shown as soon as the row reads landed, without waiting for any indexer (LAUNCH-05). */
export function LaunchLive({ state, dispatch, live }: StepProps) {
  const v = state.view as LaunchView;
  useFacts(v, dispatch);
  const image = state.image?.url ?? (v.imageCid ? `https://ipfs.io/ipfs/${v.imageCid}` : null);
  const another = () => {
    stored.set(null);
    dispatch({ type: "reset" });
  };
  return (
    <div className="grid gap-6">
      <Art image={image} />
      <h3 id="live-heading" tabIndex={-1} className="display text-[clamp(2.5rem,6vw,4.5rem)]">
        {v.symbol} is <span className="text-leaf">live.</span>
      </h3>
      {v.signature && (
        <ProofStamp signature={v.signature} net={live.status?.net ?? "devnet"}>
          {sentence(v)}
        </ProofStamp>
      )}
      <CaRow mint={v.mint} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button type="button" onClick={another}>
          Launch another
        </Button>
        <Button asChild variant="primary" size="lg" className="max-sm:flex-1">
          <Link href={`/coin/${v.mint}`}>Open {v.symbol}</Link>
        </Button>
      </div>
    </div>
  );
}
