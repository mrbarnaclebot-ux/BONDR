"use client";

import { Rocket } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "./ui-button";

/**
 * The header's quiet "Launch a coin" link on every page (D-11a); "Launch" below 768px and an icon with that
 * name below 360px, where the devnet header has no room for the word. Current on /launch.
 */
export function LaunchLink() {
  const here = usePathname() === "/launch";
  return (
    <Link
      href="/launch"
      aria-current={here ? "page" : undefined}
      className={`${buttonVariants({ variant: "quiet" })} max-sm:px-3 aria-[current=page]:border-mint`}
    >
      <Rocket strokeWidth={1.5} aria-hidden="true" className="min-[360px]:hidden" />
      <span className="max-[360px]:sr-only">
        Launch<span className="max-md:hidden"> a coin</span>
      </span>
    </Link>
  );
}
