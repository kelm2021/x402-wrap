# PRD: x402 Wrap — MVP (Week 1)

## Overview
x402 Wrap is a managed reverse proxy that lets API sellers monetize existing endpoints via the x402 payment protocol. No changes required to the origin server.

## MVP Scope (Week 1 — proxy engine only, no UI)
Single Node.js + Hono service with Redis config store and end-to-end x402 payment flow on Base Sepolia testnet.

---

## Endpoints

### POST /register
**Request body:**
```json
{
  "originUrl": "https://api.example.com/v1/data",
  "price": "0.01",
  "walletAddress": "0xABC...",
  "pathPattern": "/v1/data/*",
  "originHeaders": { "X-API-Key": "secret" }  // optional, encrypted at rest
}
```
**Response:**
```json
{
  "endpointId": "abc123",
  "proxyUrl": "https://wrap.local/p/abc123/*"
}
```
- Generate a nanoid/uuid endpointId
- Encrypt originHeaders with AES-256 if present
- Store config in Redis keyed by endpointId
- Return proxyUrl

### ALL /p/:endpointId/*
1. Look up endpointId in Redis (fail fast with 404 if not found)
2. Run x402 payment middleware (paymentRequired with price + walletAddress from config)
3. On valid payment: forward request to origin
4. Inject origin auth headers (decrypted) if present
5. Strip X-PAYMENT, Authorization, X-Forwarded-* from outgoing request
6. Stream response back to caller (support SSE/chunked)
7. Never cache X-PAYMENT headers

---

## Stack
- **Runtime:** Node.js 20 LTS
- **Framework:** Hono (not Express)
- **x402 SDK:** @x402/hono (preferred) or adapt @x402/express
- **Config store:** Redis (ioredis) — no Postgres for MVP
- **Crypto:** Node built-in `crypto` (AES-256-GCM for origin headers)
- **ID generation:** nanoid

## Environment Variables
```
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=<32-byte hex>
CDP_API_KEY=<from Coinbase>         # optional for testnet
BASE_URL=https://wrap.local          # proxy base URL
NETWORK=base-sepolia                 # testnet for MVP
```

---

## Hard Requirements
1. **AES-256 encryption** for originHeaders — key from env, never logged
2. **Header stripping** — before forwarding to origin: remove X-PAYMENT, Authorization, Host, X-Forwarded-*
3. **Streaming** — use Hono's streaming response or pipe res.body — payment check BEFORE stream opens
4. **POST body forwarding** — pass raw body buffer, support multipart/JSON/binary
5. **No replay** — never cache X-PAYMENT headers. x402 SDK handles replay protection via nonce
6. **Error handling** — 402 on unpaid, 404 on unknown endpointId, 502 on origin failure

---

## Success Criteria
- [ ] `POST /register` stores config in Redis, returns proxyUrl
- [ ] `GET /p/abc123/anything` returns HTTP 402 with valid x402 payment requirements JSON
- [ ] After valid testnet USDC payment, request proxies to origin and returns real response
- [ ] Verified with `curl` + test origin `https://x402.aurelianflo.com`
- [ ] `npm test` passes (basic integration tests)

---

## Reference Implementations
- https://github.com/cloudflare/templates/tree/main/x402-proxy-template
- https://github.com/fiv3fingers/x402-Five-Proxy
- https://github.com/coinbase/x402
- https://github.com/cloudflare/agents/tree/main/examples/x402

---

## Out of Scope for MVP
- Next.js dashboard / Clerk auth
- Postgres persistence
- Fly.io deployment
- Auto-discovery (Bazaar / 402index registration)
- Rate limiting / usage tracking
