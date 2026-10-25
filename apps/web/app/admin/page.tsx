import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminConsole } from "@/components/admin-console";
import { AdminSignIn } from "@/components/admin-signin";
import { type AdminOverview, emptyOverview, overviewData } from "@/lib/admin-data";
import { feeWindowMs } from "@/lib/coins";
import { ADMIN_COOKIE, adminSession, adminWalletEnv } from "@/lib/session";

export const dynamic = "force-dynamic";

// Linked from nowhere and kept out of search (D-11); only the sign-in card renders until the cookie is valid.
export const metadata: Metadata = { title: "BONDR owner console", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const admin = adminWalletEnv();
  const value = admin ? (await cookies()).get(ADMIN_COOKIE)?.value : undefined;
  const session = value ? adminSession(`${ADMIN_COOKIE}=${value}`, admin) : null;
  return (
    <div className="mx-auto w-full max-w-[1440px] px-(--gutter)">
      {session ? (
        <AdminConsole
          wallet={session.wallet}
          exp={session.exp}
          initial={await load(session.wallet)}
          windowMs={feeWindowMs()}
        />
      ) : (
        <AdminSignIn configured={admin !== null} />
      )}
    </div>
  );
}

// The console's one Postgres load on open (D-21). A failed read still renders the console; its panels show
// their failed state and Refresh tries again.
async function load(actor: string): Promise<AdminOverview> {
  try {
    return await overviewData(actor);
  } catch (e) {
    console.error("admin overview failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return emptyOverview();
  }
}
