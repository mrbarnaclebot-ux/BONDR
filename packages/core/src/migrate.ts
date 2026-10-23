// The only migration runner. Railway runs it as the web pre-deploy command.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

// One connection: the advisory lock is session scoped, so it must be the session that migrates.
const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  // ponytail: one global migrate lock; fine for one database per environment.
  await sql`select pg_advisory_lock(7242002)`;
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("migrations applied");
} catch (e) {
  // The message is the driver's, never the URL.
  console.error("migrations failed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
