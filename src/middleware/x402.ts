import type { MiddlewareHandler } from "hono";
import { decodePayment } from "x402/schemes";
import type { PaymentRequirements, VerifyResponse } from "x402/types";
import { VerifyError } from "x402/types";
import { useFacilitator } from "x402/verify";

const X402_VERSION = 1;
const DEFAULT_NETWORK = "base-sepolia";
const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const CDP_FACILITATOR_HOST = "api.cdp.coinbase.com";
const USDC_DECIMALS = 6n;
const USDC_MULTIPLIER = 10n ** USDC_DECIMALS;

const NETWORK_ASSET_ADDRESS: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

type SupportedNetwork = keyof typeof NETWORK_ASSET_ADDRESS;

interface X402ChallengeResponse {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: "exact";
    network: SupportedNetwork;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: "application/json";
    payTo: string;
    maxTimeoutSeconds: number;
    asset: `0x${string}`;
    extra: { name: string; version: string } | null;
  }>;
}

function getNetwork(): PaymentRequirements["network"] {
  const network = process.env.NETWORK ?? DEFAULT_NETWORK;
  if (network in NETWORK_ASSET_ADDRESS) {
    return network as PaymentRequirements["network"];
  }

  return DEFAULT_NETWORK;
}

async function generateCdpJwt(method: string, path: string): Promise<string> {
  const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
  const apiKeyId = process.env.CDP_API_KEY_ID!;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET!;
  return generateJwt({
    apiKeyId,
    apiKeySecret,
    requestMethod: method,
    requestHost: CDP_FACILITATOR_HOST,
    requestPath: path,
  });
}

function getFacilitatorClient() {
  const cdpApiKeyId = process.env.CDP_API_KEY_ID;
  const facilitatorUrl =
    process.env.FACILITATOR_URL ??
    (cdpApiKeyId ? CDP_FACILITATOR_URL : DEFAULT_FACILITATOR_URL);
  const facilitatorResource = facilitatorUrl as `${string}://${string}`;

  return useFacilitator(
    cdpApiKeyId
      ? {
          url: facilitatorResource,
          createAuthHeaders: async () => {
            const [verifyJwt, settleJwt] = await Promise.all([
              generateCdpJwt("POST", "/platform/v2/x402/verify"),
              generateCdpJwt("POST", "/platform/v2/x402/settle"),
            ]);
            return {
              verify: { Authorization: `Bearer ${verifyJwt}` },
              settle: { Authorization: `Bearer ${settleJwt}` },
              supported: { Authorization: `Bearer ${verifyJwt}` },
            };
          },
        }
      : {
          url: facilitatorResource,
        },
  );
}

function usdToAtomicUnits(price: string): string {
  const normalized = price.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid USDC price: ${price}`);
  }

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  if (fractionalPart.length > Number(USDC_DECIMALS)) {
    throw new Error(`USDC price supports at most ${USDC_DECIMALS} decimal places`);
  }

  const wholeUnits = BigInt(wholePart) * USDC_MULTIPLIER;
  const fractionalUnits = BigInt(fractionalPart.padEnd(Number(USDC_DECIMALS), "0"));

  return (wholeUnits + fractionalUnits).toString();
}

function buildPaymentRequirements(
  price: string,
  walletAddress: string,
  resource: string,
): PaymentRequirements {
  const network = getNetwork();

  return {
    scheme: "exact",
    network,
    maxAmountRequired: usdToAtomicUnits(price),
    resource,
    description: "x402 Wrap proxy payment",
    mimeType: "application/json",
    payTo: walletAddress,
    maxTimeoutSeconds: 300,
    asset: NETWORK_ASSET_ADDRESS[network],
    extra: network === "base" ? { name: "USD Coin", version: "2" } : { name: "USDC", version: "2" },
  };
}

function buildChallengeBody(
  paymentRequirements: PaymentRequirements,
  error: string,
): X402ChallengeResponse {
  return {
    x402Version: X402_VERSION,
    error,
    accepts: [
      {
        scheme: paymentRequirements.scheme,
        network: paymentRequirements.network as SupportedNetwork,
        maxAmountRequired: paymentRequirements.maxAmountRequired,
        resource: paymentRequirements.resource,
        description: paymentRequirements.description,
        mimeType: "application/json",
        payTo: paymentRequirements.payTo,
        maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
        asset: paymentRequirements.asset as `0x${string}`,
        extra: (paymentRequirements.extra as { name: string; version: string } | null) ?? { name: "USD Coin", version: "2" },
      },
    ],
  };
}

function verificationErrorMessage(
  result?: { invalidReason?: string },
  fallback = "Payment required",
): string {
  if (result?.invalidReason) {
    return `Payment verification failed: ${result.invalidReason}`;
  }

  return fallback;
}

export async function verifyPaymentHeader(
  paymentHeader: string,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResponse> {
  const paymentPayload = decodePayment(paymentHeader);
  console.log("[x402] paymentRequirements:", JSON.stringify(paymentRequirements));
  console.log("[x402] FACILITATOR_URL:", process.env.FACILITATOR_URL ?? "https://x402.org/facilitator");
  const facilitator = getFacilitatorClient();
  const result = await facilitator.verify(paymentPayload, paymentRequirements);
  console.log("[x402] verify result:", JSON.stringify(result));
  return result;
}

export const x402Internals = {
  verifyPaymentHeader,
};

export function x402Middleware(price: string, walletAddress: string): MiddlewareHandler {
  return async (c, next) => {
    const paymentRequirements = buildPaymentRequirements(
      price,
      walletAddress,
      (process.env.BASE_URL ?? "") + new URL(c.req.url).pathname,
    );
    const paymentHeader = c.req.header("x-payment");

    if (!paymentHeader) {
      return c.json(buildChallengeBody(paymentRequirements, "Payment required"), 402);
    }

    try {
      const result = await x402Internals.verifyPaymentHeader(paymentHeader, paymentRequirements);
      if (!result.isValid) {
        console.error("[x402] Verify failed:", JSON.stringify(result));
        return c.json(
          buildChallengeBody(paymentRequirements, verificationErrorMessage(result)),
          402,
        );
      }
    } catch (error) {
      console.error("[x402] Verify exception:", error);
      if (error instanceof VerifyError) {
        return c.json(
          buildChallengeBody(paymentRequirements, verificationErrorMessage(error)),
          402,
        );
      }

      return c.json(
        buildChallengeBody(paymentRequirements, "Payment verification failed"),
        402,
      );
    }

    await next();
  };
}
