import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _dbPromise: Promise<ReturnType<typeof drizzle> | null> | null = null;

async function getDb() {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  _dbPromise = (async () => {
    const postgresModule = await import("postgres");
    const postgres = postgresModule.default;
    const client = postgres(databaseUrl, { max: 10 });
    _db = drizzle(client, { schema });
    return _db;
  })();

  return _dbPromise;
}

export { getDb };
export type Db = NonNullable<ReturnType<typeof getDb>>;
