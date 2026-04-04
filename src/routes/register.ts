import { Hono } from "hono";
import type { Context } from "hono";

import { encryptHeaders } from "../lib/crypto.js";
import { getBaseUrl } from "../lib/env.js";
import { assertAllowedOrigin } from "../lib/origin-security.js";
import { createRegistrationIntent } from "../lib/registration-intents.js";
import { saveEndpointRecord } from "../lib/redis.js";
import type { RegisterPayload } from "../lib/types.js";

export const PLATFORM_WALLET = (process.env.PLATFORM_WALLET ?? "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d") as `0x${string}`;
export const REGISTRATION_FEE = process.env.REGISTRATION_FEE ?? "2";
export const DEFAULT_FEE_BPS = parseInt(process.env.DEFAULT_FEE_BPS ?? "100", 10);
export const REGISTRATION_FEE_NUM = parseFloat(REGISTRATION_FEE);
export const ONCHAIN_REGISTRATION_ENABLED = Boolean(
  process.env.CONTRACT_ADDRESS && process.env.BACKEND_SIGNER_PRIVATE_KEY,
);

function hasStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export const registerRoute = new Hono();
export const registerIntentRoute = new Hono();

async function handleRegisterIntent(c: Context) {
  const body = (await c.req.json().catch(() => null)) as RegisterPayload | null;

  if (!body?.originUrl || !body.price || !body.walletAddress) {
    return c.json({ error: "originUrl, price, walletAddress are required" }, 400);
  }

  try {
    assertAllowedOrigin(body.originUrl);
  } catch (error) {
    return c.json({ error: (error as Error).message.includes("allowed") ? (error as Error).message : `originUrl is not allowed: ${(error as Error).message}` }, 400);
  }

  const encryptedHeaders =
    body.originHeaders && hasStringRecord(body.originHeaders)
      ? encryptHeaders(body.originHeaders)
      : undefined;

  const { endpointId, record } = createRegistrationIntent({
    ...body,
    pathPattern: body.pathPattern ?? "*",
    encryptedHeaders,
  });

  await saveEndpointRecord(endpointId, record);

  const baseUrl = getBaseUrl();

  return c.json({
    endpointId,
    status: record.status,
    visibility: record.visibility,
    verificationToken: record.verificationToken,
    verificationPath: record.verificationPath,
    verificationUrl: `${new URL(body.originUrl).origin}${record.verificationPath}`,
    activationUrl: `${baseUrl}/activate/${endpointId}`,
    verificationApiUrl: `${baseUrl}/verify/${endpointId}`,
    proxyUrl: `${baseUrl}/p/${endpointId}/*`,
  });
}

registerIntentRoute.post("/", handleRegisterIntent);

// Backward-compatible alias while the dashboard migrates.
registerRoute.post("/", handleRegisterIntent);
