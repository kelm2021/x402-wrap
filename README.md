# x402 Wrap

> Monetize any API with USDC payments. Zero origin changes required.

## What it is

x402 Wrap is a small reverse proxy that puts an x402 payment gate in front of any existing HTTP API. You register an origin URL once, get back a proxy URL, and unpaid requests receive a standards-shaped `402 Payment Required` response instead of reaching your origin.

The origin does not need to know about x402. Paid traffic is verified at the proxy layer, sensitive origin headers are stored encrypted, and successful requests are forwarded as raw HTTP streams.

## How it works

1. Call `POST /register` with an origin URL, price, wallet address, and optional origin headers.
2. The service stores that config in Redis and returns a unique proxy URL.
3. Clients request the proxy URL.
4. If the client has not paid, the proxy returns an x402 `402` response with payment requirements.
5. If the client includes a valid `X-PAYMENT` header, the proxy verifies payment and forwards the original request to the origin.

## Quick Start

```bash
git clone https://github.com/kelm2021/x402-wrap
cd x402-wrap
npm install
cp .env.example .env
# edit .env with your values
redis-server &
npm run dev
```

The dev server listens on `http://localhost:3402` by default.

## API Reference

### `POST /register`

Registers a new paid proxy endpoint.

```bash
curl -X POST http://localhost:3402/register \
  -H 'Content-Type: application/json' \
  -d '{
    "originUrl": "https://api.example.com",
    "price": "0.01",
    "walletAddress": "0xYourBaseWallet",
    "originHeaders": {
      "Authorization": "Bearer upstream-secret"
    }
  }'
```

Example response:

```json
{
  "endpointId": "AbCdEf123456",
  "proxyUrl": "http://localhost:3402/p/AbCdEf123456/*"
}
```

### `ALL /p/:endpointId/*`

Requests through the monetized proxy. The path suffix and query string are forwarded to the origin.

Example unpaid response:

```json
{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:3402/p/AbCdEf123456/test",
      "description": "x402 Wrap proxy payment",
      "mimeType": "application/json",
      "payTo": "0xYourBaseWallet",
      "maxTimeoutSeconds": 300,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": null
    }
  ]
}
```

Example paid request:

```bash
curl http://localhost:3402/p/AbCdEf123456/test \
  -H 'X-PAYMENT: {"x402Version":1,"payload":"replace-with-real-payment-payload"}'
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Local server port. Defaults to `3402`. |
| `BASE_URL` | No | Public base URL used in `proxyUrl` responses. Defaults to `http://localhost:$PORT`. |
| `REDIS_URL` | Yes | Redis connection string for endpoint storage. |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key used for AES-256-GCM encryption of stored origin headers. |
| `NETWORK` | No | x402 network identifier. Defaults to `base-sepolia`. |
| `FACILITATOR_URL` | No | Optional custom x402 facilitator URL. Defaults to the x402 package facilitator. |
| `CDP_API_KEY` | No | Reserved for future facilitator auth / CDP integration. |

## Testing

Run the full suite with:

```bash
npm test
```

The integration tests mock Redis and x402 verification, so they do not require a live Redis server or live Base Sepolia payments.

## Architecture Overview

- `src/routes/register.ts` validates and stores endpoint config in Redis.
- `src/middleware/x402.ts` produces x402-compliant `402` responses and verifies paid requests.
- `src/lib/upstream.ts` forwards raw requests to the origin, preserving streaming behavior and stripping sensitive headers.
- `src/lib/crypto.ts` encrypts optional upstream auth headers before they are persisted.

## Week 2 Roadmap

- Postgres persistence as the source of truth, with Redis used as a cache.
- Fly.io deployment and environment templates.
- A basic dashboard for managing endpoints, pricing, and payout wallets.
