import { Hono } from "hono";

import { getEndpoint } from "../lib/redis.js";
import { forwardRequest } from "../lib/upstream.js";
import { x402Middleware } from "../middleware/x402.js";

export const proxyRoute = new Hono();

proxyRoute.all("/:endpointId/*", async (c) => {
  const endpointId = c.req.param("endpointId");
  const config = await getEndpoint(endpointId);

  if (!config) {
    return c.json({ error: "Endpoint not found" }, 404);
  }

  let upstreamResponse: Response | undefined;

  try {
    const middlewareResponse = await x402Middleware(config.price, config.walletAddress)(
      c,
      async () => {
        upstreamResponse = await forwardRequest(c, config);
        c.res = upstreamResponse;
      },
    );

    return middlewareResponse ?? upstreamResponse ?? c.res;
  } catch {
    return c.json({ error: "Upstream request failed" }, 502);
  }
});
