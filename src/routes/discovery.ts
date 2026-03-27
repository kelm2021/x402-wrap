import { Hono } from "hono";

import { getBaseUrl } from "../lib/env.js";
import { getNetwork } from "../lib/env.js";
import { listAllEndpoints } from "../lib/redis.js";

export const discoveryRoute = new Hono();

discoveryRoute.get("/", async (c) => {
  const baseUrl = getBaseUrl();
  const network = getNetwork();
  const endpoints = await listAllEndpoints();

  return c.json({
    version: "1.0",
    provider: "x402-wrap",
    baseUrl,
    endpoints: endpoints.map(({ endpointId, config, createdAt }) => ({
      endpointId,
      proxyUrl: `${baseUrl}/p/${endpointId}/*`,
      price: config.price,
      network,
      asset: "USDC",
      pathPattern: config.pathPattern,
      createdAt,
    })),
  });
});
