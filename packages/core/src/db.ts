import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

let instance: Db | undefined;

// Lazy so importing this module never needs DATABASE_URL (tests, next build).
export function db(): Db {
  if (!instance) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL missing");
    // idle_timeout drops idle connections so Neon compute can scale to zero (Pitfall 6).
    const client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
    instance = drizzle(client, { schema, casing: "snake_case" });
  }
  return instance;
}

export async function close(): Promise<void> {
  await instance?.$client.end({ timeout: 5 });
  instance = undefined;
}
