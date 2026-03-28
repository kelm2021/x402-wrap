import { Hono } from "hono";
import { nanoid } from "nanoid";

import { encryptHeaders } from "../lib/crypto.js";
import { submitToBazaar } from "../lib/bazaar.js";
import { getBaseUrl } from "../lib/env.js";
import { saveEndpoint } from "../lib/redis.js";
import { x402Middleware } from "../middleware/x402.js";
import type { RegisterPayload } from "../lib/types.js";

// Platform wallet — registration fee goes here
const PLATFORM_WALLET = (process.env.PLATFORM_WALLET ?? "0xCd20cb3520029a210708C36fa3f2F050414c4B12") as `0x${string}`;
const REGISTRATION_FEE = process.env.REGISTRATION_FEE ?? "1";

function hasStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export const registerRoute = new Hono();

registerRoute.post("/", x402Middleware(REGISTRATION_FEE, PLATFORM_WALLET), async (c) => {
  const body = (await c.req.json().catch(() => null)) as RegisterPayload | null;

  if (!body?.originUrl || !body.price || !body.walletAddress) {
    return c.json({ error: "originUrl, price, walletAddress are required" }, 400);
  }

  const endpointId = nanoid(12);
  const encryptedHeaders =
    body.originHeaders && hasStringRecord(body.originHeaders)
      ? encryptHeaders(body.originHeaders)
      : undefined;

  await saveEndpoint(endpointId, {
    originUrl: body.originUrl,
    price: body.price,
    walletAddress: body.walletAddress,
    pathPattern: body.pathPattern ?? "*",
    encryptedHeaders,
  });

  const baseUrl = getBaseUrl();
  const proxyUrl = `${baseUrl}/p/${endpointId}/*`;
  void submitToBazaar(endpointId, proxyUrl, body.price);

  return c.json({
    endpointId,
    proxyUrl,
    discoveryUrl: `${baseUrl}/.well-known/x402.json`,
    bazaarHint: "Endpoint discoverable via x402-wrap discovery catalog",
  });
});
