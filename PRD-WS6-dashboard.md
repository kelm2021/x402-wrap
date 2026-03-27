# Workstream 6: Next.js Dashboard + Clerk Auth

## Goal
Build a Next.js 14 (App Router) dashboard for x402-wrap. Users sign in with Clerk, register endpoints, view usage stats. Deploy to Vercel.

## Location
Create at: `/mnt/c/Users/Administrator/.openclaw/workspace/projects/x402-wrap-dashboard/`
This is a SEPARATE Next.js project from the proxy. It calls the proxy API.

## Stack
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Clerk (@clerk/nextjs) for auth
- shadcn/ui for components (or plain Tailwind if simpler)
- Deployed to Vercel

## Features

### Auth (Clerk)
- Sign in / sign up via Clerk (email + Google OAuth)
- Protected routes: dashboard requires auth
- User's endpoints are namespaced by Clerk userId

### Pages

#### / (Landing)
- Hero: "Monetize any API with USDC payments"
- CTA: "Get Started" → sign up
- How it works: 3 steps (Register → Get proxy URL → Earn USDC)
- Clean, minimal, dark or light

#### /dashboard (Protected)
- List of user's registered endpoints
- Each endpoint shows:
  - proxyUrl (copyable)
  - price (USDC)
  - originUrl (truncated)
  - totalRequests (from usage API)
  - totalRevenue (USDC earned)
  - Created at date
- "Register new endpoint" button

#### /dashboard/register (Protected)
Form:
- originUrl (required, URL validation)
- price (required, number, USDC amount e.g. "0.01")
- walletAddress (required, 0x... Ethereum address)
- pathPattern (optional, default: "/*")
- originHeaders (optional, JSON textarea for key:value pairs)

On submit: POST to x402-wrap proxy /register API
Show proxyUrl on success with copy button.

#### /dashboard/endpoints/[id] (Protected)
- Endpoint detail page
- Shows config (non-sensitive)
- Usage chart (bar chart, requests per day last 7 days)
- Recent events table (path, method, amount, timestamp)
- Uses GET /usage/:endpointId from proxy

### API Routes (Next.js)
- `/api/endpoints` — GET: list user's endpoints (store endpointId→userId mapping in a simple DB or Vercel KV)
- `/api/endpoints/register` — POST: proxy to x402-wrap /register, store mapping

### Data persistence for dashboard
Since the proxy doesn't have user auth, the dashboard needs to track which endpoints belong to which user.
Use Vercel KV (Redis) or a simple JSON file (demo) to store: `{ userId: string, endpointIds: string[] }`

Simplest approach: Vercel KV
```
VERCEL_KV_URL=...
```
Or use Upstash Redis (same as proxy, different key namespace: `user:{userId}:endpoints`)

## Environment Variables
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

PROXY_API_URL=https://x402-wrap.fly.dev   # or http://localhost:3402 for dev
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

## File Structure
```
x402-wrap-dashboard/
├── app/
│   ├── layout.tsx          # ClerkProvider wrapper
│   ├── page.tsx            # Landing
│   ├── sign-in/[[...sign-in]]/page.tsx
│   ├── sign-up/[[...sign-up]]/page.tsx
│   └── dashboard/
│       ├── layout.tsx      # Protected layout
│       ├── page.tsx        # Endpoint list
│       ├── register/
│       │   └── page.tsx    # Register form
│       └── endpoints/
│           └── [id]/
│               └── page.tsx # Endpoint detail
├── components/
│   ├── EndpointCard.tsx
│   ├── RegisterForm.tsx
│   └── UsageChart.tsx
├── lib/
│   ├── proxy-client.ts     # API calls to x402-wrap proxy
│   └── kv.ts               # Vercel KV / Upstash wrapper
├── middleware.ts            # Clerk auth middleware
├── .env.local.example
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vercel.json
```

## Done When
- `npm run dev` starts on localhost:3000
- Landing page renders
- Clerk sign-in/sign-up works (with test keys or placeholder)
- /dashboard shows endpoint list (empty state OK)
- /dashboard/register form submits to proxy API
- /dashboard/endpoints/[id] shows usage (mock data OK if proxy not live)
- Tailwind styling is clean and usable
- README.md with setup instructions
- .env.local.example with all required vars

## Important Notes
- Use Next.js App Router (not Pages Router)
- Use Clerk middleware.ts pattern for route protection
- Don't use complex state management — React hooks are fine
- If Clerk keys not configured, show a placeholder/demo mode
- Focus on functionality over polish — clean is fine, perfect is not required
- Create the project from scratch in a NEW directory (not inside x402-wrap)
