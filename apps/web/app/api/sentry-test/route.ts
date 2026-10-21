import { workerPost } from "@/lib/worker";

// OPS-01 check: one hit raises an error in the worker and here, each carrying an address the scrub must hide.
// Off unless SENTRY_TEST_ROUTE=1, so nobody can spend the Sentry quota (T-02-14-04).
export const dynamic = "force-dynamic";

const SAMPLE_ADDR = "9wRtPq3yq1ZJ8yQd2ynVfUKAnx3bK2SMQkkjD8Kq4e3F";

export async function GET(): Promise<Response> {
  if (process.env.SENTRY_TEST_ROUTE !== "1") return Response.json({ error: "not_found" }, { status: 404 });
  await workerPost("/sentry-test", {});
  throw new Error(`sentry test from web: wallet ${SAMPLE_ADDR}`);
}
