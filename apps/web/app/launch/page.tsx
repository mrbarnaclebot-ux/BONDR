import type { Metadata } from "next";
import { LaunchFlow } from "@/components/launch-flow";

export const metadata: Metadata = { title: "Launch a coin | BONDR" };

export default function LaunchPage() {
  return (
    <LaunchFlow>
      <h1 className="display text-[clamp(2.5rem,6vw,4.5rem)]">Launch a coin</h1>
      <p className="mt-3 max-w-[56ch] text-muted-foreground">
        One Phantom signature creates your coin, makes your dev buy, and sells or burns it. From then on its
        creator fees work to bond it. After bond, 80% of them are yours, permanently.
      </p>
    </LaunchFlow>
  );
}
