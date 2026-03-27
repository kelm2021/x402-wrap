# Workstream 3: Tests + README + Dev Setup

## Goal
Integration tests, README documentation, and dev-ready project setup.

## Tasks

### 1. tests/integration.test.ts — Vitest integration tests
Write tests using vitest. Start the Hono server on a random port, use a mock Redis (or redis-memory-server if available, otherwise mock ioredis).

Test cases:
1. `POST /register` with valid body → returns 200 with endpointId + proxyUrl
2. `POST /register` missing required fields → returns 400
3. `GET /p/:endpointId/anything` for unknown endpointId → returns 404
4. `GET /p/:endpointId/test` for known endpointId without X-PAYMENT → returns 402 with x402Version:1 in body
5. `GET /p/valid/test` with X-PAYMENT header → (mock the verification to pass) → proxies and returns response
6. Headers stripped: verify X-PAYMENT and Authorization not forwarded to origin (use a mock upstream)
7. Encrypted originHeaders stored and decrypted correctly (unit test crypto.ts)

### 2. README.md
Write a clear README covering:

**x402 Wrap**
> Monetize any API with USDC payments. Zero origin changes required.

Sections:
- What it is (2-3 sentences)
- How it works (numbered flow: register → proxy URL → 402 → pay → forward)
- Quick Start:
  ```bash
  git clone https://github.com/kelm2021/x402-wrap
  cd x402-wrap
  npm install
  cp .env.example .env
  # edit .env with your values
  redis-server &
  npm run dev
  ```
- API Reference:
  - `POST /register` with example curl + response
  - `ALL /p/:endpointId/*` with example 402 response and paid request
- Environment Variables table
- Testing: `npm test`
- Architecture overview (brief)
- Week 2 roadmap (Postgres persistence, Fly.io deploy, dashboard)

### 3. .ralphy/ init + rules
Run `ralphy --init` in the project root to initialize ralphy config.
Add rules:
- "Never expose encryption keys in logs"
- "Always strip X-PAYMENT headers before forwarding to origin"
- "Never parse and re-serialize request bodies"

### 4. npm install
Run `npm install` to install all dependencies and verify no errors.

### 5. Verify dev server starts
Run `npm run dev` briefly to confirm TypeScript compiles and server starts on port 3402.
Kill it after confirming startup.

## Done When
- `npm test` passes (or skips gracefully for tests requiring live Redis)
- README.md exists with working curl examples
- `npm install` completes without errors
- `.env.example` is accurate and complete
