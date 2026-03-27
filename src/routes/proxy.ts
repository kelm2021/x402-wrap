import { Hono } from "hono";

import { getEndpoint } from "../lib/redis.js";
import { trackRequest } from "../lib/usage.js";
import { forwardRequest } from "../lib/upstream.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { x402Middleware } from "../middleware/x402.js";

export const proxyRoute = new Hono();

proxyRoute.all("/:endpointId/*", async (c) => {
  const endpointId = c.req.param("endpointId");
  const config = await getEndpoint(endpointId);

  if (!config) {
    return c.json({ error: "Endpoint not found" }, 404);
  }

  // Rate limiting (before payment check)
  const rateLimitResponse = await rateLimitMiddleware(endpointId)(c, async () => {});
  if (rateLimitResponse && (rateLimitResponse as Response).status === 429) {
    trackRequest({
      endpointId,
      requestPath: c.req.path,
      method: c.req.method,
      statusCode: 429,
    });
    return rateLimitResponse;
  }

  let upstreamResponse: Response | undefined;
  let statusCode = 200;

  try {
    const middlewareResponse = await x402Middleware(config.price, config.walletAddress)(
      c,
      async () => {
        upstreamResponse = await forwardRequest(c, config);
        statusCode = upstreamResponse.status;
        c.res = upstreamResponse;
      },
    );

    const finalResponse = middlewareResponse ?? upstreamResponse ?? c.res;
    if (middlewareResponse) {
      statusCode = (middlewareResponse as Response).status;
    }

    // Fire-and-forget usage tracking
    trackRequest({
      endpointId,
      requestPath: c.req.path,
      method: c.req.method,
      statusCode,
    });

    return finalResponse;
  } catch {
    trackRequest({
      endpointId,
      requestPath: c.req.path,
      method: c.req.method,
      statusCode: 502,
    });
    return c.json({ error: "Upstream request failed" }, 502);
  }
});
