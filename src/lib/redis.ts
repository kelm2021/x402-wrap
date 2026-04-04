import type { EndpointConfig, EndpointRecord, EndpointStatus, EndpointVisibility } from "./types.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const useMock = redisUrl === "mock" || process.env.REDIS_MOCK === "true";
const REDIS_CACHE_TTL = 3600; // 1 hour

// In-memory fallback for mock/dev mode (no ioredis-mock dependency)
class InMemoryRedis {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); return "OK" as const; }
  async incr(key: string) { const v = parseInt(this.store.get(key) ?? "0", 10) + 1; this.store.set(key, String(v)); return v; }
  async expire(_key: string, _ttl: number) { return 1; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan(_cursor: string, ..._args: any[]): any {
    return Promise.resolve(["0", [...this.store.keys()]]);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mget(...keys: any[]): any { return Promise.resolve(keys.map((k: string) => this.store.get(k) ?? null)); }
}

// Dynamically pick real or mock client
const createClient = async () => {
  if (useMock) {
    return new InMemoryRedis();
  } else {
    const { default: Redis } = await import("ioredis");
    return new Redis(redisUrl, { lazyConnect: true });
  }
};

let _client: Awaited<ReturnType<typeof createClient>> | null = null;

export interface StoredEndpoint {
  endpointId: string;
  config: EndpointRecord;
  createdAt: string | null;
}

export async function getClient() {
  if (!_client) _client = await createClient();
  return _client;
}

export async function saveEndpoint(endpointId: string, config: EndpointConfig): Promise<void> {
  const existing = await getEndpointRecord(endpointId);
  const record: EndpointRecord = {
    ...config,
    status: existing?.status ?? "active",
    visibility: existing?.visibility ?? "public",
    verificationToken: existing?.verificationToken,
    verificationPath: existing?.verificationPath,
    verifiedAt: existing?.verifiedAt ?? null,
    activatedAt: existing?.activatedAt ?? new Date().toISOString(),
    lastVerificationError: existing?.lastVerificationError ?? null,
    paymentTxHash: existing?.paymentTxHash ?? null,
    activationTxHash: existing?.activationTxHash ?? null,
  };
  await saveEndpointRecord(endpointId, record);
}

export async function saveEndpointRecord(endpointId: string, config: EndpointRecord): Promise<void> {
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
    const db = await getDb();
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
          status: config.status,
          visibility: config.visibility,
          verificationToken: config.verificationToken ?? null,
          verificationPath: config.verificationPath ?? null,
          verifiedAt: config.verifiedAt ? new Date(config.verifiedAt) : null,
          activatedAt: config.activatedAt ? new Date(config.activatedAt) : null,
          lastVerificationError: config.lastVerificationError ?? null,
          paymentTxHash: config.paymentTxHash ?? null,
          activationTxHash: config.activationTxHash ?? null,
        })
        .onConflictDoUpdate({
          target: endpoints.id,
          set: {
            originUrl: config.originUrl,
            price: config.price,
            walletAddress: config.walletAddress,
            pathPattern: config.pathPattern,
            encryptedHeaders: config.encryptedHeaders ?? null,
            status: config.status,
            visibility: config.visibility,
            verificationToken: config.verificationToken ?? null,
            verificationPath: config.verificationPath ?? null,
            verifiedAt: config.verifiedAt ? new Date(config.verifiedAt) : null,
            activatedAt: config.activatedAt ? new Date(config.activatedAt) : null,
            lastVerificationError: config.lastVerificationError ?? null,
            paymentTxHash: config.paymentTxHash ?? null,
            activationTxHash: config.activationTxHash ?? null,
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
  const record = await getEndpointRecord(endpointId);
  if (!record || record.status !== "active") {
    return null;
  }

  return {
    originUrl: record.originUrl,
    price: record.price,
    walletAddress: record.walletAddress,
    pathPattern: record.pathPattern,
    encryptedHeaders: record.encryptedHeaders,
  };
}

export async function getEndpointRecord(endpointId: string): Promise<EndpointRecord | null> {
  const client = await getClient();

  // Fast path: Redis cache
  const raw = await client.get(`endpoint:${endpointId}`);
  if (raw) {
    return JSON.parse(raw) as EndpointRecord;
  }

  // Cache miss: try Postgres
  try {
    const { getDb } = await import("./db.js");
    const { endpoints } = await import("./schema.js");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(endpoints).where(eq(endpoints.id, endpointId)).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        const config: EndpointRecord = {
          originUrl: row.originUrl,
          price: row.price,
          walletAddress: row.walletAddress,
          pathPattern: row.pathPattern,
          encryptedHeaders: row.encryptedHeaders as EndpointConfig["encryptedHeaders"],
          status: row.status as EndpointStatus,
          visibility: row.visibility as EndpointVisibility,
          verificationToken: row.verificationToken ?? undefined,
          verificationPath: row.verificationPath ?? undefined,
          verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
          activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
          lastVerificationError: row.lastVerificationError ?? null,
          paymentTxHash: row.paymentTxHash ?? null,
          activationTxHash: row.activationTxHash ?? null,
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

export async function listAllEndpoints(): Promise<StoredEndpoint[]> {
  try {
    const { getDb } = await import("./db.js");
    const { endpoints } = await import("./schema.js");
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(endpoints);
      return rows.map((row) => ({
        endpointId: row.id,
        config: {
          originUrl: row.originUrl,
          price: row.price,
          walletAddress: row.walletAddress,
          pathPattern: row.pathPattern,
          encryptedHeaders: row.encryptedHeaders as EndpointConfig["encryptedHeaders"],
          status: row.status as EndpointStatus,
          visibility: row.visibility as EndpointVisibility,
          verificationToken: row.verificationToken ?? undefined,
          verificationPath: row.verificationPath ?? undefined,
          verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
          activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
          lastVerificationError: row.lastVerificationError ?? null,
          paymentTxHash: row.paymentTxHash ?? null,
          activationTxHash: row.activationTxHash ?? null,
        },
        createdAt: row.createdAt.toISOString(),
      }));
    }
  } catch (err) {
    console.debug("[redis] Postgres list skipped:", (err as Error).message);
  }

  const client = await getClient();
  const keys = new Set<string>();
  let cursor = "0";

  do {
    const result = await client.scan(cursor, "MATCH", "endpoint:*", "COUNT", 100);
    cursor = result[0];
    for (const key of result[1]) {
      keys.add(key);
    }
  } while (cursor !== "0");

  const endpointKeys = [...keys];
  if (endpointKeys.length === 0) {
    return [];
  }

  const rawConfigs = await client.mget(...endpointKeys);
  return endpointKeys.flatMap((key, index) => {
    const raw = rawConfigs[index];
    if (!raw) {
      return [];
    }

    return [
      {
        endpointId: key.replace(/^endpoint:/, ""),
        config: JSON.parse(raw) as EndpointRecord,
        createdAt: null,
      },
    ];
  });
}
