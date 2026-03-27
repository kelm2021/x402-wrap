# PRD: x402 Wrap — Architecture Decisions

## Key Architecture Decisions for MVP

### 1. Hono over Express
Use Hono. Native streaming support, edge-ready, TypeScript-first. The @x402/express middleware can be adapted but @x402/hono is preferred.

### 2. Redis-first config store
For MVP: Redis only (ioredis). No Postgres yet. 
- Key: `endpoint:{endpointId}` → JSON blob
- TTL: none (permanent until deleted)
- Add Postgres as source-of-truth in Week 2

### 3. x402 middleware placement
Payment middleware fires BEFORE upstream proxy. Architecture:
```
Request → endpointId lookup → 402 middleware → header strip → origin forward → stream response
```

### 4. Body forwarding strategy
Use `req.raw` (Hono raw Request) to get the body as ArrayBuffer/stream. 
Pass directly to fetch() as body. Don't parse/re-serialize.

### 5. Streaming strategy
Use Hono `streamSSE` or `stream` for SSE. For regular chunked: pipe ReadableStream from origin fetch() directly into response.

### 6. Origin auth encryption
AES-256-GCM. Store: `{ iv: hex, tag: hex, ciphertext: hex }` in Redis alongside other config.
Decrypt at proxy time, inject as headers, never log.

### 7. Facilitator config
Primary: CDP (https://api.cdp.coinbase.com)
Fallback: x402.org
Configure via x402 SDK `createFacilitator()` or equivalent.

### 8. Network
Base Sepolia for MVP. Switch to Base mainnet for production via env var.

## File Structure
```
/
├── src/
│   ├── index.ts          # Hono app entry
│   ├── routes/
│   │   ├── register.ts   # POST /register
│   │   └── proxy.ts      # ALL /p/:endpointId/*
│   ├── lib/
│   │   ├── redis.ts      # Redis client + config ops
│   │   ├── crypto.ts     # AES-256-GCM encrypt/decrypt
│   │   └── proxy.ts      # Upstream fetch + header handling
│   └── middleware/
│       └── x402.ts       # x402 payment middleware setup
├── tests/
│   └── integration.test.ts
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```
