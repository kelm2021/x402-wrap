import { Hono } from "hono";

import { submitToBazaar } from "../lib/bazaar.js";
import { getBaseUrl } from "../lib/env.js";
import { assertSafeResolvedOrigin, buildVerificationUrl } from "../lib/origin-security.js";
import { getEndpointRecord, saveEndpointRecord } from "../lib/redis.js";
import { registerEndpointWithAuthorizationOnChain } from "../lib/splitter.js";
import { buildChallengeBody, buildPaymentRequirements, x402Internals } from "../middleware/x402.js";
import { DEFAULT_FEE_BPS, ONCHAIN_REGISTRATION_ENABLED, PLATFORM_WALLET, REGISTRATION_FEE } from "./register.js";

export const verifyRoute = new Hono();
export const activateRoute = new Hono();

verifyRoute.post("/:endpointId", async (c) => {
  const endpointId = c.req.param("endpointId");
  const record = await getEndpointRecord(endpointId);

  if (!record) {
    return c.json({ error: "Endpoint not found" }, 404);
  }

  try {
    await assertSafeResolvedOrigin(record.originUrl);
    const verificationUrl = buildVerificationUrl(record.originUrl, record.verificationToken ?? "");
    const response = await fetch(verificationUrl, {
      headers: { accept: "text/plain,application/json;q=0.9,*/*;q=0.8" },
    });

    if (!response.ok) {
      const updated = {
        ...record,
        status: "failed_verification" as const,
        lastVerificationError: `Verification file returned ${response.status}`,
      };
      await saveEndpointRecord(endpointId, updated);
      return c.json({ error: updated.lastVerificationError, status: updated.status, verified: false }, 400);
    }

    const body = (await response.text()).trim();
    if (body !== record.verificationToken) {
      const updated = {
        ...record,
        status: "failed_verification" as const,
        lastVerificationError: "Verification token mismatch",
      };
      await saveEndpointRecord(endpointId, updated);
      return c.json({ error: updated.lastVerificationError, status: updated.status, verified: false }, 400);
    }

    const updated = {
      ...record,
      status: "pending_payment" as const,
      verifiedAt: new Date().toISOString(),
      lastVerificationError: null,
    };
    await saveEndpointRecord(endpointId, updated);

    return c.json({
      endpointId,
      status: updated.status,
      verified: true,
      verifiedAt: updated.verifiedAt,
    });
  } catch (error) {
    const updated = {
      ...record,
      status: "failed_verification" as const,
      lastVerificationError: (error as Error).message,
    };
    await saveEndpointRecord(endpointId, updated);
    return c.json({ error: updated.lastVerificationError, status: updated.status, verified: false }, 400);
  }
});

activateRoute.post("/:endpointId", async (c) => {
  const endpointId = c.req.param("endpointId");
  const record = await getEndpointRecord(endpointId);

  if (!record) {
    return c.json({ error: "Endpoint not found" }, 404);
  }

  if (!record.verifiedAt) {
    return c.json({ error: "Origin verification is required before activation", status: record.status }, 409);
  }

  const paymentRequirements = buildPaymentRequirements(
    REGISTRATION_FEE,
    PLATFORM_WALLET,
    `${getBaseUrl()}/activate/${endpointId}`,
    ONCHAIN_REGISTRATION_ENABLED
      ? {
          forcePayTo: process.env.CONTRACT_ADDRESS as `0x${string}`,
        }
      : { forcePayTo: PLATFORM_WALLET },
  );

  const paymentHeader = c.req.header("x-payment");
  if (!paymentHeader) {
    return c.json(buildChallengeBody(paymentRequirements, "Payment required"), 402);
  }

  try {
    const verificationResult = await x402Internals.verifyPaymentHeader(paymentHeader, paymentRequirements);
    if (!verificationResult.isValid) {
      return c.json(buildChallengeBody(paymentRequirements, "Payment verification failed"), 402);
    }

    let activationTxHash: string | null = null;
    let paymentTxHash: string | null = null;

    if (ONCHAIN_REGISTRATION_ENABLED) {
      activationTxHash = await registerEndpointWithAuthorizationOnChain(
        endpointId,
        record.walletAddress,
        DEFAULT_FEE_BPS,
        paymentHeader,
      );
      paymentTxHash = activationTxHash;
    } else {
      const settlement = await x402Internals.settlePaymentHeader(paymentHeader, paymentRequirements);
      paymentTxHash = settlement.transaction ?? null;
      activationTxHash = null;
    }

    const updated = {
      ...record,
      status: "active" as const,
      activatedAt: new Date().toISOString(),
      paymentTxHash,
      activationTxHash,
    };

    await saveEndpointRecord(endpointId, updated);
    void submitToBazaar(endpointId, `${getBaseUrl()}/p/${endpointId}/*`, updated.price);

    return c.json({
      endpointId,
      status: updated.status,
      proxyUrl: `${getBaseUrl()}/p/${endpointId}/*`,
      visibility: updated.visibility,
      paymentTxHash,
      activationTxHash,
    });
  } catch (error) {
    console.error("[activate] failed:", error);
    return c.json({ error: `Activation failed: ${(error as Error).message}` }, 502);
  }
});
