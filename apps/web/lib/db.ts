// server-only makes the build fail if a client component ever imports the database.
import "server-only";

export * from "@bondr/core/db"; // db(), close() and every table (core/db re-exports the schema)
