# x402 Wrap Hardening Session Update

Date: 2026-04-04

This note records the implementation and production verification work completed after the original hardening plan in:

`C:\Users\KentEgan\claude projects\Content\x402-wrap\docs\plans\2026-04-03-hardening-plan.md`

## Completed

### Backend hardening flow

- Added staged registration flow:
  - `POST /register-intent`
  - `POST /verify/:endpointId`
  - `POST /activate/:endpointId`
- Added origin safety checks and verification token flow using:
  - `/.well-known/x402-wrap-verification/<token>`
- Added activation states covering:
  - `pending_verification`
  - `failed_verification`
  - `pending_payment`
  - `active`
- Restricted discovery to `active + public` endpoints only.
- Re-check origin safety before proxy fetches.

Key files:

- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\index.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\routes\register.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\routes\verify.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\routes\discovery.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\origin-security.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\registration-intents.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\upstream.ts`

### Persistence and production state

- Added richer endpoint and intent persistence.
- Enabled Fly Postgres for production instead of Redis-only persistence.
- Applied the schema migration and verified fresh live intents are written to Postgres.
- Fixed async Postgres initialization issues in the write path.

Key files:

- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\db.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\usage.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\lib\schema.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap\drizzle\0000_naive_ted_forrester.sql`

### Dashboard onboarding

- Updated the dashboard to support the staged onboarding flow:
  - create intent
  - verify ownership
  - pay activation fee
  - confirm endpoint activation
- Removed unsafe production fallbacks for backend URL and JWT secret behavior.
- Confirmed the dashboard flow works end to end through the real UI.

Key files:

- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\components\RegisterForm.tsx`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\components\EndpointCard.tsx`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\lib\proxy-client.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\lib\auth.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\lib\env.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\lib\kv.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\app\api\endpoints\register\route.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\app\api\endpoints\verify\route.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-wrap-dashboard\app\api\endpoints\activate\route.ts`

### Mainnet activation and splitter path

- Moved wrap activation from Base Sepolia to Base mainnet.
- Re-enabled splitter-based settlement on Base mainnet with a newly deployed contract after fixing smart-wallet signature handling.
- Verified live activation on mainnet.
- Verified live proxy payment on a dashboard-created endpoint.
- Verified live settlement split:
  - owner cut: 99%
  - proxy cut: 1%

Live splitter contract:

- `0x05f7E84e57dEdD0808279719a00ecD87531b2938`

Relevant files:

- `C:\Users\KentEgan\claude projects\Content\x402-wrap\src\middleware\x402.ts`
- `C:\Users\KentEgan\claude projects\Content\x402-proxy-wrapper\src\EndpointRegistrySplitter.sol`
- `C:\Users\KentEgan\claude projects\Content\x402-proxy-wrapper\src\mocks\MockERC20.sol`
- `C:\Users\KentEgan\claude projects\Content\x402-proxy-wrapper\test\EndpointRegistrySplitter.t.sol`

### Contract publishing

- Verified and published the live Base mainnet splitter on BaseScan.
- Confirmed leftover Sepolia/test artifacts are not fully publishable from the current repo state because they either:
  - do not have code deployed anymore, or
  - were deployed from older bytecode that does not match the current source tree

Published contract:

- `https://basescan.org/address/0x05f7E84e57dEdD0808279719a00ecD87531b2938`

## Verification completed

### Local verification

- `x402-wrap` integration tests passed.
- `x402-wrap` build passed.
- `x402-wrap-dashboard` typecheck passed.
- `x402-wrap-dashboard` build passed.
- `x402-proxy-wrapper` Foundry tests passed.

### Live verification

- `wrap-api.aurelianflo.com` is live on the staged registration flow.
- `wrap.aurelianflo.com` is live on the updated dashboard.
- A real dashboard registration completed successfully.
- A real proxy payment succeeded through `awal`.
- A live onchain split was observed and confirmed.

Dashboard-tested endpoint:

- `bruEc_Fze3kh`

Observed proxy settlement:

- total amount: `20000` raw USDC units
- owner cut: `19800`
- proxy cut: `200`

## Remaining non-blocking items

- Optional custom verification hostname polish for `verify.aurelianflo.com`
- Docs cleanup in older PRD files so they match the shipped flow exactly
- Stronger seller analytics and visibility management improvements
- DNS re-resolution hardening improvements over time

## Current signoff

Phase 1 hardening is complete and production-verified:

- origin safety
- ownership proof
- staged activation
- Postgres persistence
- dashboard onboarding
- Base mainnet activation
- splitter settlement
