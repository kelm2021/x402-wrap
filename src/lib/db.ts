import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (_db) return _db;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  // Lazy import to avoid requiring pg unless DATABASE_URL is set
  const postgres = require("postgres");
  const client = postgres(databaseUrl, { max: 10 });
  _db = drizzle(client, { schema });
  return _db;
}

export { getDb };
export type Db = NonNullable<ReturnType<typeof getDb>>;
