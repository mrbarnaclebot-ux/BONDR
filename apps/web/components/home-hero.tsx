"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { thousands } from "@/lib/format";
import { useHome } from "./home-live";
import { Button, buttonVariants } from "./ui-button";

// 16 motes at fixed pseudo-random spots (the mockup's seeded rng), so server and client render the same markup.
const MOTES = Array.from({ length: 16 }, (_, i) => {
  const r = (k: number, scale: number, base = 0) =>
    (base + ((((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1) * scale).toFixed(2);
  return {
    left: `${r(1, 50, 45)}%`,
    top: `${r(2, 60, 25)}%`,
    "--d": `${r(3, 8, 7)}s`,
    "--dl": `-${r(4, 10)}s`,
    "--dx": `${r(5, 60, -30)}px`,
  } as CSSProperties;
});

/** Motion is allowed (never under reduced motion, nor in the server render) and not paused by the viewer. */
function useHeroMotion() {
  const [motion, setMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => setMotion(!matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return { motion, paused, toggle: () => setPaused((p) => !p) };
}

/** The video loops only when motion is allowed; reduced motion (and the server render) keeps the still. */
function HeroArt({ motion, paused }: { motion: boolean; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (paused) video.current?.pause();
    else void video.current?.play().catch(() => {}); // autoplay refused: the poster stays
  }, [paused]);
  return (
    <>
      <div aria-hidden="true" className="hero-art">
        {motion ? (
          <video
            ref={video}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/art/hero-bond-poster.jpg"
          >
            <source src="/art/hero-bond.mp4" type="video/mp4" />
          </video>
        ) : (
          <img
            src="/art/hero-bond.jpg"
            srcSet="/art/hero-bond-960.jpg 960w, /art/hero-bond.jpg 1920w"
            sizes="100vw"
            alt=""
          />
        )}
      </div>
      {motion && (
        <div aria-hidden="true" className="motes">
          {MOTES.map((style, i) => (
            <i key={i} style={style} />
          ))}
        </div>
      )}
    </>
  );
}

/** The D-09 counts, counting up on live launch and bond events; hidden when the read failed. */
function Pulse() {
  const { counts } = useHome();
  if (!counts) return null;
  const { launched, bonded } = counts;
  return (
    <p className="mt-6 flex items-center gap-2.5 text-sm text-muted-foreground">
      <span aria-hidden="true" className="size-2 flex-none animate-live rounded-full bg-leaf text-leaf" />
      {launched === 0 ? (
        <span>No coins launched yet.</span>
      ) : (
        <span>
          <b className="num font-normal text-foreground">{thousands(launched)}</b>{" "}
          {launched === 1 ? "coin" : "coins"} launched,{" "}
          <b className="num font-normal text-foreground">{thousands(bonded)}</b> bonded.
        </span>
      )}
    </p>
  );
}

/** Launch a coin (or the disabled Launches paused) and See all coins. */
function Ctas({ paused }: { paused: boolean }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {paused ? (
        <Button variant="primary" size="lg" disabled>
          Launches paused
        </Button>
      ) : (
        <Link href="/launch" className={buttonVariants({ variant: "primary", size: "lg" })}>
          Launch a coin
        </Link>
      )}
      <a href="#all-coins" className={buttonVariants({ variant: "quiet", size: "lg" })}>
        See all coins
      </a>
    </div>
  );
}

/**
 * Home hero (UI-SPEC Hero): headline, lede, Launch a coin and See all coins, the D-09 pulse line, the art. The
 * looping art gets a Pause animation toggle (WCAG 2.2.2); under reduced motion nothing moves, so there is none.
 */
export function HomeHero({ paused }: { paused: boolean }) {
  const art = useHeroMotion();
  return (
    <section aria-labelledby="hero-h" className="hero" data-paused={art.paused || undefined}>
      <HeroArt motion={art.motion} paused={art.paused} />
      <div className="hero-in mx-auto w-full max-w-[1440px] px-(--gutter)">
        <div>
          <h1 id="hero-h" className="hero-h1 display">
            Built <br />
            to <em>bond.</em>
          </h1>
          <p className="mt-6 max-w-[46ch] leading-[1.6] text-[color-mix(in_oklch,var(--foreground)_82%,var(--background))]">
            Every coin on BONDR launches with one job: reach its bond. Until it does, its creator fees buy its
            own curve to completion and burn what they buy. If a day passes without a bond, those fees buy and
            burn BONDR instead.
          </p>
          <Ctas paused={paused} />
          <Pulse />
          {art.motion && (
            <Button className="mt-4 px-3 text-xs" onClick={art.toggle}>
              {art.paused ? "Play animation" : "Pause animation"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
