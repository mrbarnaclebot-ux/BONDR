import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TERMS_VERSION } from "@/lib/terms";

export const metadata: Metadata = { title: "Terms - BONDR" };

// D-07 draft, verbatim from 02-UI-SPEC "Terms page". The owner reviews it at Phase 2 sign-off; a change
// to the wording means a new TERMS_VERSION, which consent rows also record.

type Section = { n: string; title: string; nav: string; body: ReactNode };

const SECTIONS: Section[] = [
  {
    n: "01",
    title: "What BONDR is",
    nav: "What BONDR is",
    body: (
      <p>
        BONDR is a hobby project: a site that launches and trades Solana memecoins through pump.fun's public
        programs. It is software, not a broker, exchange or adviser. It is run by one person. While BONDR is
        being tested it runs on Solana devnet, where coins have no value.
      </p>
    ),
  },
  {
    n: "02",
    title: "Your wallet, your responsibility",
    nav: "Your wallet",
    body: (
      <p>
        You connect with Phantom and sign every transaction yourself. BONDR never holds your keys.
        Transactions on Solana are final; nobody, including BONDR, can reverse them.
      </p>
    ),
  },
  {
    n: "03",
    title: "Fees",
    nav: "Fees",
    body: (
      <>
        <p>
          Trading fees are set by pump's programs, not by BONDR, and BONDR adds no platform fee. The launch
          screen and each coin's page show the fees read live from the chain. Every BONDR coin's creator of
          record is a fee wallet that BONDR controls for that coin only, and BONDR uses its creator fees only
          under these published rules:
        </p>
        <ul className="mt-2 list-disc pl-[1.2em]">
          <li>Before bond, 90% builds a burn budget and 10% goes to the BONDR treasury.</li>
          <li>
            When the budget reaches 105% of the cost to finish the curve, it buys the rest of the curve and
            burns what it buys.
          </li>
          <li>
            A budget not used within a 24-hour window goes 90% to buying and burning BONDR and 10% to the
            treasury.
          </li>
          <li>After bond, the deployer gets 80% of the creator fee and the treasury 20%, permanently.</li>
        </ul>
        <p className="mt-2">Every fee movement is recorded with a transaction link.</p>
      </>
    ),
  },
  {
    n: "04",
    title: "Launching",
    nav: "Launching",
    body: (
      <p>
        When you launch, your dev buy is sold or burned in the same transaction, as you choose. This cannot be
        undone. Names, symbols and images must not be illegal or impersonate someone. BONDR may hide a coin
        from its lists or block a wallet from launching; it cannot remove a coin from Solana.
      </p>
    ),
  },
  {
    n: "05",
    title: "Risk",
    nav: "Risk",
    body: (
      <p>
        Memecoins are speculative and can go to zero in minutes. Only use money you can lose. Nothing on BONDR
        is financial advice.
      </p>
    ),
  },
  {
    n: "06",
    title: "Your data",
    nav: "Your data",
    body: (
      <p>
        BONDR stores nothing about your wallet until you accept these terms. After you accept, BONDR stores
        your wallet address, when you accepted, the coins you launch and their transactions, and trades you
        make through BONDR. Error reports go to Sentry without your wallet address. You can ask the owner to
        delete the off-chain records at any time; on-chain data is public and permanent.
      </p>
    ),
  },
  {
    n: "07",
    title: "No warranty",
    nav: "No warranty",
    body: (
      <p>
        BONDR is provided as is. Pump can change its programs without notice, so features may pause or break,
        and launches may stop while BONDR's own token migrates.
      </p>
    ),
  },
  {
    n: "08",
    title: "Changes and contact",
    nav: "Changes",
    body: (
      <p>
        These terms may change; the date above shows when. Continuing to use BONDR after a change means you
        accept it. Questions go to the owner through @BONDR on X (handle to be confirmed before go-live).
      </p>
    ),
  },
];

function TermsSection({ n, title, body }: Section) {
  return (
    <section id={`t${n}`} aria-labelledby={`t${n}-h`} className="scroll-mt-[88px]">
      <h2 id={`t${n}-h`} className="mb-2 flex items-baseline gap-3 text-lg font-semibold">
        <span className="num text-sm font-normal text-mint">{n}</span> {title}
      </h2>
      {body}
    </section>
  );
}

function TermsNav() {
  return (
    <nav
      aria-labelledby="terms-nav"
      className="sticky top-[88px] hidden gap-1.5 self-start rounded-lg border border-line bg-linear-to-b from-surface-2 to-surface p-4 text-sm shadow-elev-1 md:grid"
    >
      <span
        id="terms-nav"
        className="text-xs font-semibold tracking-[0.09em] text-muted-foreground uppercase"
      >
        On this page
      </span>
      {SECTIONS.map((s) => (
        <a
          key={s.n}
          href={`#t${s.n}`}
          className="py-[3px] text-muted-foreground no-underline hover:text-foreground"
        >
          {s.nav}
        </a>
      ))}
    </nav>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-6 px-(--gutter) pt-12 md:grid-cols-[220px_minmax(0,68ch)] md:gap-12 md:pt-16">
      <TermsNav />
      <article className="grid gap-8 leading-[1.65]">
        <header>
          <h1 className="display text-[clamp(2.5rem,6vw,4.5rem)]">Terms</h1>
          <p className="mt-3 text-muted-foreground">
            Short on purpose. Last updated <span className="num">{TERMS_VERSION}</span>.
          </p>
        </header>
        {SECTIONS.map((s) => (
          <TermsSection key={s.n} {...s} />
        ))}
      </article>
    </div>
  );
}
