import { configDefaults, defineConfig } from "vitest/config";

// Suites that seed and read the shared Neon dev branch. Run in parallel they time out on the 0.25 CU compute and
// see each other's rows, so they run one file at a time after the rest. A new DB-backed suite belongs here.
const DB = [
  "apps/web/lib/coins.test.ts",
  "apps/web/lib/ledger.test.ts",
  "apps/web/lib/trades.test.ts",
  "apps/worker/src/fee-ledger.test.ts",
  "apps/worker/src/ingest.test.ts",
  "apps/worker/src/prepare.test.ts",
  "apps/worker/src/trade-prepare.test.ts",
  "apps/worker/src/vanity.test.ts",
  "packages/core/src/db-admin.test.ts",
  "packages/core/src/db.test.ts",
];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
    projects: [
      { extends: true, test: { name: "unit", exclude: [...configDefaults.exclude, ".claude/**", ...DB] } },
      {
        extends: true,
        test: { name: "db", include: DB, fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
