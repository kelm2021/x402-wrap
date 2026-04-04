# x402 Wrap Hardening Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add origin ownership proof, SSRF protections, and activation state management to x402 Wrap without breaking the existing proxy model.

**Architecture:** Introduce a registration-intent layer ahead of active endpoints. Sellers create a pending intent, prove origin ownership via a token file under `/.well-known/`, and complete paid activation only after the origin is verified and safe. Endpoint discovery and proxying use richer endpoint metadata so only active public endpoints leak into the catalog.

**Tech Stack:** Hono, TypeScript, Redis/Postgres dual persistence, Next.js dashboard, viem/wagmi wallet signing, x402 payment middleware.

---

### Task 1: Add failing backend tests for origin safety and intent flow

**Files:**
- Modify: `tests/integration.test.ts`

**Steps:**
1. Add a failing test for `POST /register-intent` rejecting localhost/private-IP origins.
2. Add a failing test for `POST /register-intent` returning an intent with `pending_verification` state and a `/.well-known/` verification path.
3. Add a failing test for `POST /verify/:intentId` promoting a verified+paid intent to an active endpoint.
4. Add a failing test for discovery excluding non-public or non-active endpoints.

### Task 2: Implement backend registration intents and endpoint metadata

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/redis.ts`
- Modify: `src/lib/schema.ts`
- Create: `src/lib/origin-security.ts`
- Create: `src/lib/registration-intents.ts`

**Steps:**
1. Introduce types for `RegistrationIntent`, `EndpointRecord`, status enums, verification token fields, and visibility.
2. Extend storage helpers to persist intents and richer endpoint records.
3. Add origin parsing and SSRF guards shared by registration, verification, and proxying.

### Task 3: Implement backend verification and activation routes

**Files:**
- Modify: `src/index.ts`
- Modify: `src/routes/register.ts`
- Create: `src/routes/verify.ts`
- Modify: `src/routes/discovery.ts`
- Modify: `src/routes/proxy.ts`
- Modify: `src/lib/upstream.ts`

**Steps:**
1. Replace direct registration with `POST /register-intent`.
2. Add `POST /verify/:intentId` and `POST /activate/:intentId`.
3. Require both `verified` and `paymentSettled` before creating an active endpoint.
4. Filter discovery to `active + public`.
5. Re-check origin safety before proxy fetches.

### Task 4: Update dashboard onboarding flow

**Files:**
- Modify: `app/api/endpoints/register/route.ts`
- Modify: `app/api/endpoints/challenge/route.ts`
- Modify: `app/api/endpoints/route.ts`
- Modify: `lib/proxy-client.ts`
- Modify: `lib/kv.ts`
- Modify: `components/RegisterForm.tsx`
- Modify: `components/EndpointCard.tsx`

**Steps:**
1. Split onboarding into intent creation, verification, and activation.
2. Show seller-facing state and verification instructions.
3. Persist intent/endpoint records with status and visibility fields.
4. Keep payment as a guided checkout step, not a raw protocol step.

### Task 5: Verify

**Files:**
- None

**Steps:**
1. Run backend test command(s) that cover the new flow.
2. Run Solidity tests for the splitter contract.
3. Run dashboard type/build verification if available.
4. Summarize any residual risks, especially around DNS re-resolution and seller UX.

---

## Status

Implementation and live verification updates from the follow-on build session are tracked in:

`C:\Users\KentEgan\claude projects\Content\x402-wrap\docs\plans\2026-04-04-hardening-session-update.md`
