# Workstream 5: Postgres Persistence + Rate Limiting + Usage Tracking

## Goal
Add Postgres as source of truth for endpoint configs. Redis remains as cache layer.
Also add per-endpoint request counting and rate limiting.

## Stack additions
- `postgres` or `pg` npm package (or use `@vercel/postgres` / `drizzle-orm`)
- Recommended: use `drizzle-orm` with `postgres` driver for clean TypeScript
- `drizzle-kit` for migrations

## Database Schema

### Table: endpoints
```sql
CREATE TABLE endpoints (
  id TEXT PRIMARY KEY,                    -- nanoid endpointId
  origin_url TEXT NOT NULL,
  price TEXT NOT NULL,                    -- USDC amount e.g. "0.01"
  wallet_address TEXT NOT NULL,
  path_pattern TEXT NOT NULL,
  encrypted_headers JSONB,               -- { iv, tag, ciphertext } or null
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: usage_events
```sql
CREATE TABLE usage_events (
  id BIGSERIAL PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
  request_path TEXT NOT NULL,
  method TEXT NOT NULL,
  paid_amount TEXT,                       -- USDC amount from payment
  status_code INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON usage_events (endpoint_id, created_at DESC);
```

## Tasks

### 1. Install dependencies
```
npm install drizzle-orm postgres
npm install -D drizzle-kit @types/pg
```

### 2. src/lib/db.ts — Drizzle client
- Export drizzle client using DATABASE_URL env var
- Export schema types

### 3. src/lib/schema.ts — Drizzle schema
Define `endpoints` and `usage_events` tables as Drizzle schema objects.

### 4. drizzle.config.ts — Migration config
```ts
export default {
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
};
```

### 5. Update src/lib/redis.ts
Modify `saveEndpoint` to write to BOTH Postgres (source of truth) AND Redis (cache).
Modify `getEndpoint` to:
1. Check Redis first (fast path)
2. If Redis miss, query Postgres, then populate Redis cache
3. TTL on Redis cache: 3600 seconds

### 6. Update src/routes/register.ts
After saving to Redis, also save to Postgres via db.insert().
Return same response format.

### 7. src/lib/usage.ts — Usage tracking
```ts
export async function trackRequest(params: {
  endpointId: string;
  requestPath: string;
  method: string;
  paidAmount?: string;
  statusCode?: number;
}): Promise<void>

export async function getUsage(endpointId: string, since?: Date): Promise<{
  totalRequests: number;
  totalRevenue: string;  // sum of paidAmount
  recentEvents: UsageEvent[];
}>
```

### 8. Wire usage tracking into src/routes/proxy.ts
After forwarding request, call trackRequest() asynchronously (fire-and-forget — don't block response).

### 9. GET /usage/:endpointId endpoint
Add to register.ts or a new route:
```
GET /usage/:endpointId
→ { totalRequests, totalRevenue, recentEvents: [...last 10] }
```
No auth for MVP — endpointId IS the auth token.

### 10. Rate limiting (simple, Redis-based)
In src/middleware/rateLimit.ts:
- Sliding window counter in Redis: key = `ratelimit:{endpointId}:{minute}`
- Default limit: 100 requests/minute per endpoint
- Return 429 with Retry-After header if exceeded
- Wire into proxy route BEFORE x402 middleware

### 11. Environment variables
Add to .env.example:
```
DATABASE_URL=postgresql://user:pass@localhost:5432/x402wrap
RATE_LIMIT_RPM=100
```

### 12. Migration command
Add to package.json scripts:
```json
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

## Done When
- POST /register writes to both Postgres + Redis
- GET /p/:id proxy looks up from Redis (falls back to Postgres)
- Each proxied request logged to usage_events (async, non-blocking)
- GET /usage/:endpointId returns stats
- Rate limiting returns 429 after 100 req/min
- Drizzle migrations exist in /drizzle folder
- DATABASE_URL in .env.example

## Important Notes
- Keep Redis as primary config cache for proxy performance
- Postgres is for durability and the dashboard to query
- If DATABASE_URL not set, skip Postgres (graceful degradation)
- Usage tracking MUST be fire-and-forget — never slow down proxy response
