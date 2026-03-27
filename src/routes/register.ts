import { Hono } from "hono";
import { nanoid } from "nanoid";

import { encryptHeaders } from "../lib/crypto.js";
import { getBaseUrl } from "../lib/env.js";
import { saveEndpoint } from "../lib/redis.js";
import type { RegisterPayload } from "../lib/types.js";

function hasStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

export const registerRoute = new Hono();

registerRoute.post("/", async (c) => {
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

  return c.json({
    endpointId,
    proxyUrl: `${getBaseUrl()}/p/${endpointId}/*`,
  });
});
