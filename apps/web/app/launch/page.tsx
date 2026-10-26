import type { Metadata } from "next";
import { headers } from "next/headers";
import { LaunchFlow } from "@/components/launch-flow";
import { adminSession, adminWalletEnv } from "@/lib/session";

export const metadata: Metadata = { title: "Launch a coin | BONDR" };
// The owner genesis variant depends on the request's admin cookie (UI-SPEC surface 2).
export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  // Only a boolean crosses to the client, never the wallet (T-07-18-03). The worker stays the gate (D-29).
  const owner = adminSession((await headers()).get("cookie"), adminWalletEnv()) !== null;
  return (
    <LaunchFlow ownerGenesis={owner}>
      <h1 className="display text-[clamp(2.5rem,6vw,4.5rem)]">Launch a coin</h1>
      <p className="mt-3 max-w-[56ch] text-muted-foreground">
        One Phantom signature creates your coin, makes your dev buy, and sells or burns it. From then on its
        creator fees work to bond it. After bond, 80% of them are yours, permanently.
      </p>
    </LaunchFlow>
  );
}
