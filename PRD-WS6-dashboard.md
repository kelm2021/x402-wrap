# Workstream 6: Next.js Dashboard + Wallet Auth

## Status: COMPLETE ✅
Deployed at: https://x402.pwrap.aurelianflo.com
Repo: https://github.com/kelm2021/x402-wrap-dashboard

## What Was Built

Next.js 14 (App Router) dashboard with wallet-based authentication (Sign-In with Ethereum). **Clerk was evaluated and rejected** — replaced with wagmi + RainbowKit + SIWE.

## Auth Stack
- **wagmi** + **RainbowKit** — wallet connect UI
- **Sign-In with Ethereum (SIWE)** — nonce/sign/verify flow
- **JWT session cookie** (jose, HS256, 7-day expiry, httpOnly)
- No third-party auth provider — fully self-contained

## Auth Flow
1. User clicks "Connect Wallet" → RainbowKit modal
2. Wallet connects → auto-triggers sign message: `Sign in to x402-wrap: <nonce>`
3. POST `/api/auth/verify` with `{ address, signature, nonce }`
4. Server verifies signature via viem `verifyMessage`, sets `x402-session` JWT cookie
5. All subsequent API calls authenticated via cookie

## API Routes
- `GET /api/auth/nonce` — returns one-time UUID nonce
- `POST /api/auth/verify` — verifies SIWE signature, sets session cookie
- `POST /api/auth/logout` — clears session cookie
- `GET /api/endpoints` — list user's registered endpoints (requires auth)
- `POST /api/endpoints/register` — register new endpoint via proxy API (requires auth)

## Pages
- `/` — Landing page → "Get Started" → `/dashboard`
- `/dashboard` — Endpoint list (connects wallet if not authed)
- `/dashboard/register` — Register new endpoint form
- `/dashboard/endpoints/[id]` — Endpoint detail + usage chart

## Environment Variables (Vercel)
```
JWT_SECRET=25ab7216886d2ecd0e7da763d16bae71b725b731c16416402005718c823ba393
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=d3cfba3fae36739e4e086a8b58598395
PROXY_API_URL=https://x402-wrap.fly.dev
UPSTASH_REDIS_REST_URL=...  (needs setting for user→endpoint mapping persistence)
UPSTASH_REDIS_REST_TOKEN=... (needs setting)
```

## Known Outstanding Items
- Upstash Redis not yet configured — user→endpoint mapping is in-memory only (resets on deploy)
- `/dashboard/endpoints/[id]` usage chart may use mock data until real usage API is wired
- Smoke test wallet connect UI end-to-end in real browser

## Stack
- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- wagmi + RainbowKit
- viem (signature verification)
- jose (JWT)
- Deployed to Vercel
