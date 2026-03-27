import { desc, eq, gte, sum } from "drizzle-orm";
import { getDb } from "./db.js";
import { usageEvents } from "./schema.js";
import type { UsageEvent } from "./schema.js";

export interface UsageSummary {
  totalRequests: number;
  totalRevenue: string;
  recentEvents: UsageEvent[];
}

/**
 * Track a proxy request asynchronously. Fire-and-forget — never awaited in hot path.
 */
export function trackRequest(params: {
  endpointId: string;
  requestPath: string;
  method: string;
  paidAmount?: string;
  statusCode?: number;
}): void {
  const db = getDb();
  if (!db) return; // Postgres not configured — skip silently

  db.insert(usageEvents)
    .values({
      endpointId: params.endpointId,
      requestPath: params.requestPath,
      method: params.method,
      paidAmount: params.paidAmount ?? null,
      statusCode: params.statusCode ?? null,
    })
    .catch((err: Error) => {
      // Non-blocking — log but don't throw
      console.error("[usage] Failed to track request:", err.message);
    });
}

/**
 * Get usage stats for an endpoint.
 */
export async function getUsage(endpointId: string, since?: Date): Promise<UsageSummary> {
  const db = getDb();
  if (!db) {
    return { totalRequests: 0, totalRevenue: "0", recentEvents: [] };
  }

  const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default 30 days

  const [totals, recent] = await Promise.all([
    db
      .select({
        totalRequests: sum(usageEvents.id).mapWith(Number),
        totalRevenue: sum(usageEvents.paidAmount),
      })
      .from(usageEvents)
      .where(eq(usageEvents.endpointId, endpointId)),

    db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.endpointId, endpointId))
      .orderBy(desc(usageEvents.createdAt))
      .limit(10),
  ]);

  return {
    totalRequests: totals[0]?.totalRequests ?? 0,
    totalRevenue: String(totals[0]?.totalRevenue ?? "0"),
    recentEvents: recent,
  };
}
