# Workstream 1: Core Proxy Engine

## Goal
Build the main Hono application with the upstream proxy forwarding logic.

## Tasks

### 1. src/index.ts — App entry point
Create the Hono app, mount routes, start @hono/node-server on PORT env var (default 3402).
Load dotenv if available.

### 2. src/lib/redis.ts — Redis client
- Export a singleton ioredis client using REDIS_URL env var
- Export functions:
  - `saveEndpoint(endpointId: string, config: EndpointConfig): Promise<void>`
  - `getEndpoint(endpointId: string): Promise<EndpointConfig | null>`
- EndpointConfig type:
  ```ts
  interface EndpointConfig {
    originUrl: string;
    price: string;         // in USDC, e.g. "0.01"
    walletAddress: string;
    pathPattern: string;
    encryptedHeaders?: { iv: string; tag: string; ciphertext: string };
  }
  ```

### 3. src/lib/crypto.ts — AES-256-GCM encryption
- `encryptHeaders(headers: Record<string, string>): { iv: string; tag: string; ciphertext: string }`
- `decryptHeaders(encrypted: { iv: string; tag: string; ciphertext: string }): Record<string, string>`
- Use ENCRYPTION_KEY env var (32-byte hex). Use Node built-in `crypto`.

### 4. src/routes/register.ts — POST /register
- Validate body: originUrl, price, walletAddress required
- Generate endpointId with nanoid (12 chars)
- Encrypt originHeaders if present
- Save to Redis
- Return `{ endpointId, proxyUrl }` where proxyUrl = `${BASE_URL}/p/${endpointId}/*`

### 5. src/lib/upstream.ts — Upstream proxy fetch
- `forwardRequest(c: Context, config: EndpointConfig): Promise<Response>`
- Build target URL: config.originUrl + path suffix from wildcard
- Strip headers before forwarding: x-payment, authorization, host, x-forwarded-for, x-forwarded-proto, x-real-ip
- Inject decrypted origin headers if present
- Forward method, body (raw), remaining headers
- Return the fetch() Response (for streaming)

### 6. src/routes/proxy.ts — ALL /p/:endpointId/*
- Look up endpointId in Redis → 404 if missing
- Apply x402 payment check (see workstream 2 for middleware — for now stub it: if no X-PAYMENT header, return 402 with basic JSON)
- On payment OK: call forwardRequest()
- Pipe response body directly to Hono response (preserve status, content-type, headers)
- Handle streaming (SSE, chunked) via ReadableStream passthrough

## Hard Rules
- Never log header values (keys only)
- Never cache X-PAYMENT headers
- Body must be forwarded as raw bytes — do NOT parse/re-serialize
- All source in TypeScript, strict mode

## Done When
- Server starts with `npm run dev`
- POST /register returns a proxyUrl
- GET /p/:endpointId/anything returns 402 JSON
- With X-PAYMENT: "bypass" header (for stub testing), proxies to origin and returns real response
