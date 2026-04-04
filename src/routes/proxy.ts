import { Hono } from "hono";
import { decodePayment } from "x402/schemes";

import { getEndpoint } from "../lib/redis.js";
import { trackRequest } from "../lib/usage.js";
import { forwardRequest } from "../lib/upstream.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { x402Middleware } from "../middleware/x402.js";

export const proxyRoute = new Hono();
const USDC_DECIMALS = 6n;
const USDC_MULTIPLIER = 10n ** USDC_DECIMALS;

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
    const middlewareResponse = await x402Middleware(config.price, config.walletAddress ?? "0x0000000000000000000000000000000000000000", endpointId)(
      c,
      async () => {
        upstreamResponse = await forwardRequest(c, config);
        statusCode = upstreamResponse.status;
      },
    );

    const finalResponse = middlewareResponse ?? upstreamResponse;
    if (middlewareResponse) {
      statusCode = (middlewareResponse as Response).status;
    }

    const paidAmount = statusCode >= 200 && statusCode < 300 ? getPaidAmountFromHeader(c.req.header("x-payment")) : undefined;

    // Fire-and-forget usage tracking
    trackRequest({
      endpointId,
      requestPath: c.req.path,
      method: c.req.method,
      paidAmount,
      statusCode,
    });

    return finalResponse;
  } catch (err) {
    console.error("[proxy] upstream error:", err);
    trackRequest({
      endpointId,
      requestPath: c.req.path,
      method: c.req.method,
      statusCode: 502,
    });
    return c.json({ error: "Upstream request failed" }, 502);
  }
});

function getPaidAmountFromHeader(paymentHeader?: string): string | undefined {
  if (!paymentHeader) return undefined;

  try {
    const decoded = decodePayment(paymentHeader) as {
      payload?: {
        authorization?: {
          value?: string;
        };
      };
    };
    const atomicValue = decoded.payload?.authorization?.value;
    if (!atomicValue) return undefined;

    return atomicToDecimalUsdc(atomicValue);
  } catch {
    return undefined;
  }
}

function atomicToDecimalUsdc(atomicValue: string): string {
  const amount = BigInt(atomicValue);
  const whole = amount / USDC_MULTIPLIER;
  const fraction = amount % USDC_MULTIPLIER;

  if (fraction === 0n) return whole.toString();

  const fractional = fraction.toString().padStart(Number(USDC_DECIMALS), "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractional}`;
}
