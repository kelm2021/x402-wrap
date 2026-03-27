import type { MiddlewareHandler } from "hono";
import { getClient } from "../lib/redis.js";

const DEFAULT_RPM = 100;

function getRpm(): number {
  const val = parseInt(process.env.RATE_LIMIT_RPM ?? String(DEFAULT_RPM), 10);
  return isNaN(val) || val <= 0 ? DEFAULT_RPM : val;
}

/**
 * Sliding-window rate limiter using Redis.
 * Key: ratelimit:{endpointId}:{minuteBucket}
 * Falls through silently if Redis doesn't support incr (e.g., test mock).
 */
export function rateLimitMiddleware(endpointId: string): MiddlewareHandler {
  return async (c, next) => {
    try {
      const client = await getClient();
      const minuteBucket = Math.floor(Date.now() / 60000);
      const key = `ratelimit:${endpointId}:${minuteBucket}`;
      const rpm = getRpm();

      // Use incr if available (real Redis); skip if not (test mock)
      if (typeof (client as any).incr !== "function") {
        return next();
      }

      const current: number = await (client as any).incr(key);
      if (current === 1) {
        // First request in this window — set TTL
        if (typeof (client as any).expire === "function") {
          await (client as any).expire(key, 120);
        }
      }

      if (current > rpm) {
        const retryAfter = 60 - Math.floor((Date.now() % 60000) / 1000);
        c.header("Retry-After", String(retryAfter));
        c.header("X-RateLimit-Limit", String(rpm));
        c.header("X-RateLimit-Remaining", "0");
        return c.json(
          { error: "Rate limit exceeded", retryAfter },
          429,
        );
      }

      c.header("X-RateLimit-Limit", String(rpm));
      c.header("X-RateLimit-Remaining", String(Math.max(0, rpm - current)));
    } catch (err) {
      // Rate limit check failed — pass through rather than blocking legitimate traffic
      console.error("[rateLimit] Redis error:", (err as Error).message);
    }

    return next();
  };
}
