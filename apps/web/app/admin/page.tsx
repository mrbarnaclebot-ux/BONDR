import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminConsole } from "@/components/admin-console";
import { AdminSignIn } from "@/components/admin-signin";
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
        <AdminConsole wallet={session.wallet} exp={session.exp} />
      ) : (
        <AdminSignIn configured={admin !== null} />
      )}
    </div>
  );
}
