# Workstream 7: Auto-discovery / Bazaar Registration

## Goal
When a new endpoint is registered via POST /register on x402-wrap, automatically submit it to the x402 Bazaar discovery layer so buyers and AI agents can find it.

## Background
The x402 Bazaar (docs.cdp.coinbase.com/x402/bazaar) is a machine-readable catalog for x402-compatible API endpoints.

**Key insight from docs:** In Bazaar v2, endpoints appear automatically when a facilitator processes a successful payment for them. There is no separate REST "registration" API to POST to.

However, **402index.io** and the Bazaar v1 approach had manual registration. Also, the x402.org facilitator exposes a discovery endpoint at `/facilitator` and the CDP facilitator at `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`.

## Approach for x402-wrap

Since x402-wrap IS the payment middleware (the proxy that enforces x402), we need to:

1. **Add a `/.well-known/x402.json` endpoint** — Machine-readable catalog of all registered endpoints (like a sitemap for x402 agents). This is the simplest self-discovery approach.

2. **Update POST /register response** to include bazaar metadata hints.

3. **Register with 402index.io** — Submit each new endpoint to 402index.io (which accepts submissions from Bazaar, Satring, or self-registration) when it's created.

## Implementation

### 1. GET /.well-known/x402.json

Returns a JSON catalog of all registered endpoints (non-sensitive data only):

```json
{
  "version": "1.0",
  "provider": "x402-wrap",
  "baseUrl": "https://x402-wrap.fly.dev",
  "endpoints": [
    {
      "endpointId": "abc123",
      "proxyUrl": "https://x402-wrap.fly.dev/p/abc123/*",
      "price": "0.01",
      "network": "base",
      "asset": "USDC",
      "pathPattern": "/*",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

This is safe — no originUrl, no walletAddress, no encrypted headers exposed.

### 2. Update GET /register response

Add `bazaarHint` field to the response:

```json
{
  "endpointId": "abc123",
  "proxyUrl": "https://x402-wrap.fly.dev/p/abc123/*",
  "bazaarHint": "Your endpoint will appear in Bazaar discovery after the first successful payment through the CDP facilitator.",
  "discoveryUrl": "https://x402-wrap.fly.dev/.well-known/x402.json"
}
```

### 3. 402index.io submission (best-effort, non-blocking)

When an endpoint registers, attempt to submit to 402index.io in the background.
Research the 402index.io API first. If no POST API exists, skip and log a message.
The registration should be fire-and-forget — never fail the main /register response.

## Files to modify

- `src/routes/register.ts` — add bazaarHint to response, trigger background 402index submission
- `src/routes/discovery.ts` (NEW) — GET /.well-known/x402.json handler
- `src/lib/bazaar.ts` (NEW) — 402index.io submission logic
- `src/index.ts` — mount discovery route

## Done When
- GET /.well-known/x402.json returns valid JSON catalog
- POST /register response includes discoveryUrl and bazaarHint
- Background submission to 402index.io attempted (pass or skip gracefully)
- No breaking changes to existing routes or middleware
- Build passes: `npm run build`
- Commit all changes

## Notes
- Do NOT expose originUrl, walletAddress, or encryptedHeaders in the discovery catalog
- The /.well-known/x402.json endpoint should be public (no auth)
- If 402index.io has no submission API, just implement the /.well-known/x402.json endpoint and note that in code comments
