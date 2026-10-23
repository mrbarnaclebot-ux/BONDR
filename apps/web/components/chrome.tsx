import Link from "next/link";
import { WalletButton } from "./wallet-button";

// Server component only: no chain id ships in a client bundle (D-15), so the pump id lives here.
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const short = (id: string) => `${id.slice(0, 4)}…${id.slice(-3)}`;
const isDevnet = () => process.env.SOLANA_NET === "devnet";

const WRAP = "mx-auto flex w-full max-w-[1440px] px-(--gutter)";

function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="size-[30px] transition-transform duration-600 ease-(--ease-spring) group-hover:-rotate-12 group-hover:scale-105"
    >
      <path d="M9 16h14" stroke="var(--forest)" strokeWidth="5" strokeLinecap="round" />
      <path d="M9 16h9" stroke="var(--leaf)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="9" cy="16" r="6.5" fill="var(--leaf)" />
      <circle cx="23" cy="16" r="6" fill="var(--background)" stroke="var(--mint)" strokeWidth="2.4" />
    </svg>
  );
}

function DevnetBadge() {
  return (
    <span
      title="Staging on Solana devnet. Coins here have no value."
      className="inline-flex items-center rounded-full border border-warn/45 bg-warn-wash px-2 py-1 text-xs font-semibold tracking-[0.05em] text-warn uppercase"
    >
      Devnet
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/82 backdrop-blur-[14px] backdrop-saturate-120">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface-2 px-4 py-3 text-sm font-semibold text-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>
      <div className={`${WRAP} min-h-[58px] items-center gap-3 md:min-h-16 md:gap-6`}>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="BONDR home"
            className="group flex items-center gap-2.5 text-foreground no-underline"
          >
            <BrandMark />
            <span className="font-display text-[1.6rem] leading-none font-extrabold tracking-[0.04em] max-[359px]:hidden">
              BONDR
            </span>
          </Link>
          {isDevnet() && <DevnetBadge />}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const cluster = isDevnet() ? "?cluster=devnet" : "";
  const link = "text-muted-foreground hover:text-foreground";
  return (
    <footer className="mt-24 border-t border-line">
      <div className={`${WRAP} flex-wrap gap-x-6 gap-y-3 py-6 text-xs text-muted-foreground`}>
        <span>BONDR adds no platform fee.</span>
        <Link href="/terms" className={link}>
          Terms
        </Link>
        <a
          href={`https://solscan.io/account/${PUMP_PROGRAM}${cluster}`}
          target="_blank"
          rel="noopener"
          className={link}
        >
          Program: pump <span className="num">{short(PUMP_PROGRAM)}</span>
          <span className="sr-only"> (opens Solscan)</span>
        </a>
        {/* The lightweight-charts license notice (Apache-2.0 NOTICE asks for a TradingView link). */}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener" className={link}>
          Charts by TradingView<span className="sr-only"> (opens TradingView)</span>
        </a>
      </div>
    </footer>
  );
}
