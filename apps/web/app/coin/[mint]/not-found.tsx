import Link from "next/link";
import { Button } from "@/components/ui-button";

/** UI-SPEC empty state for an unknown, malformed or not-yet-landed mint (served with HTTP 404). */
export default function CoinNotFound() {
  return (
    <div className="mx-auto grid w-full max-w-[1440px] justify-items-start gap-4 px-(--gutter) py-16">
      <h1 className="display text-[28px] leading-none">No BONDR coin here</h1>
      <p className="max-w-[56ch] text-muted-foreground">
        There is no coin launched through BONDR at this address. Check the address, or launch your own.
      </p>
      <Button asChild>
        <Link href="/launch">Launch a coin</Link>
      </Button>
    </div>
  );
}
