import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { createPublicClient, formatUnits, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getDb } from "./db.js";
import { usageEvents } from "./schema.js";
import type { UsageEvent as DbUsageEvent } from "./schema.js";

export interface UsageEvent {
  path: string;
  method: string;
  amount: string;
  timestamp: string;
}

export interface UsageDailyStat {
  date: string;
  requests: number;
  revenue: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalRevenue: string;
  dailyStats: UsageDailyStat[];
  recentEvents: UsageEvent[];
}

/**
 * Track a proxy request asynchronously. Fire-and-forget; never awaited in the hot path.
 */
export function trackRequest(params: {
  endpointId: string;
  requestPath: string;
  method: string;
  paidAmount?: string;
  statusCode?: number;
}): void {
  void getDb()
    .then((db) => {
      if (!db) return;

      return db.insert(usageEvents).values({
        endpointId: params.endpointId,
        requestPath: params.requestPath,
        method: params.method,
        paidAmount: params.paidAmount ?? null,
        statusCode: params.statusCode ?? null,
      });
    })
    .catch((err: Error) => {
      // Non-blocking; log but do not throw.
      console.error("[usage] Failed to track request:", err.message);
    });
}

/**
 * Get usage stats for an endpoint.
 */
export async function getUsage(endpointId: string, since?: Date): Promise<UsageSummary> {
  const db = await getDb();
  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default 30 days

  if (!db) {
    return getOnchainUsage(endpointId, sinceDate);
  }

  const whereClause = and(eq(usageEvents.endpointId, endpointId), gte(usageEvents.createdAt, sinceDate));
  const dayBucket = sql`date_trunc('day', ${usageEvents.createdAt})`;

  const [totals, daily, recent] = await Promise.all([
    db
      .select({
        totalRequests: count(),
        totalRevenue: sql<string>`coalesce(sum(cast(${usageEvents.paidAmount} as numeric)), 0)`,
      })
      .from(usageEvents)
      .where(whereClause),

    db
      .select({
        date: sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`,
        requests: count(),
        revenue: sql<string>`coalesce(sum(cast(${usageEvents.paidAmount} as numeric)), 0)`,
      })
      .from(usageEvents)
      .where(whereClause)
      .groupBy(dayBucket)
      .orderBy(dayBucket),

    db
      .select()
      .from(usageEvents)
      .where(whereClause)
      .orderBy(desc(usageEvents.createdAt))
      .limit(10),
  ]);

  const mappedRecent = recent.map(mapRecentEvent);

  return {
    totalRequests: totals[0]?.totalRequests ?? 0,
    totalRevenue: normalizeDecimalString(totals[0]?.totalRevenue ?? "0"),
    dailyStats: daily.map((row) => ({
      date: row.date,
      requests: row.requests,
      revenue: normalizeDecimalString(row.revenue),
    })),
    recentEvents: mappedRecent,
  };
}

function mapRecentEvent(event: DbUsageEvent): UsageEvent {
  return {
    path: event.requestPath,
    method: event.method,
    amount: normalizeDecimalString(event.paidAmount ?? "0"),
    timestamp: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
  };
}

function normalizeDecimalString(value: string): string {
  if (!value || value === "0") return "0.00";
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0.00";
}

const PAYMENT_SETTLED_EVENT = parseAbiItem(
  "event PaymentSettled(bytes32 indexed paymentRef, bytes32 indexed endpointId, address indexed payer, uint256 amount, uint256 ownerCut, uint256 proxyCut)",
);
const LOG_CHUNK_SIZE = 10_000n;
const MAX_LOOKBACK_BLOCKS = 200_000n;

async function getOnchainUsage(endpointId: string, sinceDate: Date): Promise<UsageSummary> {
  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.RPC_URL;
  if (!contractAddress || !rpcUrl) {
    return { totalRequests: 0, totalRevenue: "0.00", dailyStats: [], recentEvents: [] };
  }

  try {
    const network = (process.env.NETWORK ?? "base").toLowerCase();
    const chain = network === "base-sepolia" ? baseSepolia : base;
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const endpointBytes32 = endpointIdToBytes32(endpointId);
    const logs = await fetchPaymentSettledLogs(publicClient, contractAddress, endpointBytes32);

    if (logs.length === 0) {
      return { totalRequests: 0, totalRevenue: "0.00", dailyStats: [], recentEvents: [] };
    }

    const logsWithTimestamps = await enrichLogsWithTimestamp(publicClient, logs);
    const filtered = logsWithTimestamps
      .filter((log) => log.timestamp >= sinceDate)
      .sort((a, b) => {
        if (a.blockNumber === b.blockNumber) {
          return b.logIndex - a.logIndex;
        }
        return b.blockNumber > a.blockNumber ? 1 : -1;
      });

    const totalOwnerCutAtomic = filtered.reduce((acc, log) => acc + log.ownerCut, 0n);
    const totalRevenue = normalizeDecimalString(formatUnits(totalOwnerCutAtomic, 6));

    const dailyMap = new Map<string, { requests: number; ownerCut: bigint }>();
    for (const log of filtered) {
      const date = log.timestamp.toISOString().slice(0, 10);
      const entry = dailyMap.get(date) ?? { requests: 0, ownerCut: 0n };
      entry.requests += 1;
      entry.ownerCut += log.ownerCut;
      dailyMap.set(date, entry);
    }

    const dailyStats: UsageDailyStat[] = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, entry]) => ({
        date,
        requests: entry.requests,
        revenue: normalizeDecimalString(formatUnits(entry.ownerCut, 6)),
      }));

    const recentEvents: UsageEvent[] = filtered.slice(0, 10).map((log) => ({
      path: "(on-chain settlement)",
      method: "PAYMENT",
      amount: normalizeDecimalString(formatUnits(log.ownerCut, 6)),
      timestamp: log.timestamp.toISOString(),
    }));

    return {
      totalRequests: filtered.length,
      totalRevenue,
      dailyStats,
      recentEvents,
    };
  } catch (err) {
    console.error("[usage] On-chain usage fallback failed:", (err as Error).message);
    return { totalRequests: 0, totalRevenue: "0.00", dailyStats: [], recentEvents: [] };
  }
}

async function fetchPaymentSettledLogs(
  client: any,
  contractAddress: `0x${string}`,
  endpointBytes32: `0x${string}`,
) {
  const latestBlock = await client.getBlockNumber();
  const startBlock = latestBlock > MAX_LOOKBACK_BLOCKS ? latestBlock - MAX_LOOKBACK_BLOCKS : 0n;
  const allLogs: Array<{
    blockNumber?: bigint | null;
    logIndex?: number | null;
    args?: { ownerCut?: bigint };
  }> = [];

  for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += LOG_CHUNK_SIZE) {
    const toBlock = fromBlock + LOG_CHUNK_SIZE - 1n > latestBlock ? latestBlock : fromBlock + LOG_CHUNK_SIZE - 1n;
    const logs = await client.getLogs({
      address: contractAddress,
      event: PAYMENT_SETTLED_EVENT,
      args: { endpointId: endpointBytes32 },
      fromBlock,
      toBlock,
    });
    allLogs.push(...(logs as Array<{ blockNumber?: bigint | null; logIndex?: number | null; args?: { ownerCut?: bigint } }>));
  }

  return allLogs;
}

async function enrichLogsWithTimestamp(
  client: any,
  logs: Array<{
    blockNumber?: bigint | null;
    logIndex?: number | null;
    args?: {
      ownerCut?: bigint;
    };
  }>,
) {
  const blockMap = new Map<bigint, Date>();
  await Promise.all(
    [...new Set(logs.map((log) => log.blockNumber!))].map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      blockMap.set(blockNumber, new Date(Number(block.timestamp) * 1000));
    }),
  );

  return logs.map((log) => ({
    blockNumber: log.blockNumber ?? 0n,
    logIndex: log.logIndex ?? 0,
    timestamp: blockMap.get(log.blockNumber ?? 0n) ?? new Date(0),
    ownerCut: (log.args?.ownerCut ?? 0n) as bigint,
  }));
}

function endpointIdToBytes32(endpointId: string): `0x${string}` {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(endpointId);
  const padded = new Uint8Array(32);
  padded.set(bytes.slice(0, 32));
  return (`0x${Buffer.from(padded).toString("hex")}`) as `0x${string}`;
}
