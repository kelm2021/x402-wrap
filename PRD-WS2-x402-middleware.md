# Workstream 2: x402 Payment Middleware

## Goal
Wire up the x402 SDK payment middleware to Hono so that:
- Unpaid requests get a proper HTTP 402 with payment requirements
- Paid requests (valid X-PAYMENT header + CDP verification) pass through

## Reference
- x402 SDK: https://github.com/coinbase/x402
- x402 Hono example: https://github.com/cloudflare/agents/tree/main/examples/x402
- Cloudflare proxy template: https://github.com/cloudflare/templates/tree/main/x402-proxy-template
- Five Proxy: https://github.com/fiv3fingers/x402-Five-Proxy

First, study what's available in the `x402` npm package (already in package.json).
Run: `npm ls x402` and inspect `node_modules/x402/dist/` to understand exports.

## Tasks

### 1. Research x402 package exports
Before writing code, check:
- What does `import { ... } from 'x402'` expose?
- Is there a Hono middleware? Express middleware?
- What are `paymentRequired`, `createFacilitator`, `verify` etc.?

### 2. src/middleware/x402.ts
Create a Hono middleware factory:
```ts
export function x402Middleware(price: string, walletAddress: string): MiddlewareHandler
```

This middleware should:
1. Check for X-PAYMENT header on incoming request
2. If missing → return HTTP 402 with x402-compliant JSON body:
   ```json
   {
     "x402Version": 1,
     "error": "Payment required",
     "accepts": [{
       "scheme": "exact",
       "network": "base-sepolia",
       "maxAmountRequired": "<price in USDC atomic units>",
       "resource": "<request URL>",
       "description": "x402 Wrap proxy payment",
       "mimeType": "application/json",
       "payTo": "<walletAddress>",
       "maxTimeoutSeconds": 300,
       "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
       "extra": null
     }]
   }
   ```
3. If X-PAYMENT present → verify via CDP facilitator
   - Use NETWORK env var (default: base-sepolia)
   - CDP_API_KEY if set
   - On verification failure → return 402 with error
   - On success → call next() so proxy proceeds

### 3. Wire into src/routes/proxy.ts
Replace the stub 402 check with `x402Middleware(config.price, config.walletAddress)`.

The middleware must be per-request (price/wallet come from config loaded per endpointId).

### 4. USDC asset address by network
- base-sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Done When
- Unauthenticated request returns proper x402 402 response
- Response headers include Content-Type: application/json
- x402Version: 1 in body
- With a valid testnet X-PAYMENT header, verification passes and proxy forwards
- Verified by inspecting 402 response body with curl
