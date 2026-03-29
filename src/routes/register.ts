import { Hono } from "hono";
import { nanoid } from "nanoid";

import { encryptHeaders } from "../lib/crypto.js";
import { submitToBazaar } from "../lib/bazaar.js";
import { getBaseUrl } from "../lib/env.js";
import { saveEndpoint } from "../lib/redis.js";
import { x402Middleware } from "../middleware/x402.js";
import { registerEndpointOnChain, forwardRegistrationFee } from "../lib/splitter.js";
import type { RegisterPayload } from "../lib/types.js";

// Platform wallet — registration fee goes here
const PLATFORM_WALLET = (process.env.PLATFORM_WALLET ?? "0x348Df429BD49A7506128c74CE1124A81B4B7dC9d") as `0x${string}`;
const REGISTRATION_FEE = process.env.REGISTRATION_FEE ?? "2";
const DEFAULT_FEE_BPS = parseInt(process.env.DEFAULT_FEE_BPS ?? "100", 10); // 1%

function hasStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export const registerRoute = new Hono();

registerRoute.post("/", x402Middleware(REGISTRATION_FEE, PLATFORM_WALLET, undefined, { forcePayTo: PLATFORM_WALLET, skipSettle: true }), async (c) => {
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

  // Forward registration fee to platform wallet (fire-and-forget)
  if (process.env.REGISTRATION_FORWARDER_ADDRESS && process.env.BACKEND_SIGNER_PRIVATE_KEY) {
    void forwardRegistrationFee().catch((err) => {
      console.error("[splitter] forwardRegistrationFee failed:", err);
    });
  }

  // Register endpoint on-chain (fire-and-forget, don't block response)
  if (process.env.CONTRACT_ADDRESS && process.env.BACKEND_SIGNER_PRIVATE_KEY) {
    void registerEndpointOnChain(endpointId, body.walletAddress, DEFAULT_FEE_BPS).catch((err) => {
      console.error("[splitter] registerEndpoint on-chain failed:", err);
    });
  }

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
