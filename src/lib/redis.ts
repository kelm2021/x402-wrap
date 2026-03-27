import type { EndpointConfig } from "./types.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const useMock = redisUrl === "mock" || process.env.REDIS_MOCK === "true";
const REDIS_CACHE_TTL = 3600; // 1 hour

// Dynamically pick real or mock client
const createClient = async () => {
  if (useMock) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: IORedisMock } = await import("ioredis-mock" as any);
    return new IORedisMock();
  } else {
    const { default: Redis } = await import("ioredis");
    return new Redis(redisUrl, { lazyConnect: true });
  }
};

let _client: Awaited<ReturnType<typeof createClient>> | null = null;

export async function getClient() {
  if (!_client) _client = await createClient();
  return _client;
}

export async function saveEndpoint(endpointId: string, config: EndpointConfig): Promise<void> {
  const client = await getClient();
  // Write to Redis cache
  await client.set(`endpoint:${endpointId}`, JSON.stringify(config));
  // Set TTL if supported (ioredis supports expire, mock may not)
  if (typeof (client as any).expire === "function") {
    (client as any).expire(`endpoint:${endpointId}`, REDIS_CACHE_TTL).catch(() => {});
  }

  // Write to Postgres as source of truth (if configured)
  try {
    const { getDb } = await import("./db.js");
    const { endpoints } = await import("./schema.js");
    const db = getDb();
    if (db) {
      await db
        .insert(endpoints)
        .values({
          id: endpointId,
          originUrl: config.originUrl,
          price: config.price,
          walletAddress: config.walletAddress,
          pathPattern: config.pathPattern,
          encryptedHeaders: config.encryptedHeaders ?? null,
        })
        .onConflictDoUpdate({
          target: endpoints.id,
          set: {
            originUrl: config.originUrl,
            price: config.price,
            walletAddress: config.walletAddress,
            pathPattern: config.pathPattern,
            encryptedHeaders: config.encryptedHeaders ?? null,
            updatedAt: new Date(),
          },
        });
    }
  } catch (err) {
    // Postgres not available — Redis-only mode, that's fine
    console.debug("[redis] Postgres write skipped:", (err as Error).message);
  }
}

export async function getEndpoint(endpointId: string): Promise<EndpointConfig | null> {
  const client = await getClient();

  // Fast path: Redis cache
  const raw = await client.get(`endpoint:${endpointId}`);
  if (raw) {
    return JSON.parse(raw) as EndpointConfig;
  }

  // Cache miss: try Postgres
  try {
    const { getDb } = await import("./db.js");
    const { endpoints } = await import("./schema.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    if (db) {
      const rows = await db.select().from(endpoints).where(eq(endpoints.id, endpointId)).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        const config: EndpointConfig = {
          originUrl: row.originUrl,
          price: row.price,
          walletAddress: row.walletAddress,
          pathPattern: row.pathPattern,
          encryptedHeaders: row.encryptedHeaders as EndpointConfig["encryptedHeaders"],
        };
        // Repopulate Redis cache
        await client.set(`endpoint:${endpointId}`, JSON.stringify(config));
        if (typeof (client as any).expire === "function") {
          (client as any).expire(`endpoint:${endpointId}`, REDIS_CACHE_TTL).catch(() => {});
        }
        return config;
      }
    }
  } catch (err) {
    console.debug("[redis] Postgres read skipped:", (err as Error).message);
  }

  return null;
}
