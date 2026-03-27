const BAZAAR_CLAIM_URL = "https://402index.io/api/v1/claim";
const BAZAAR_DOMAIN = "x402-wrap.fly.dev";

interface BazaarClaimPayload {
  domain: string;
  endpointId: string;
  proxyUrl: string;
  price: string;
}

export async function submitToBazaar(
  endpointId: string,
  proxyUrl: string,
  price: string,
): Promise<void> {
  const payload: BazaarClaimPayload = {
    domain: BAZAAR_DOMAIN,
    endpointId,
    proxyUrl,
    price,
  };

  try {
    const response = await fetch(BAZAAR_CLAIM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn("[bazaar] 402index submission failed", {
        endpointId,
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }

    console.info("[bazaar] 402index submission accepted", { endpointId, proxyUrl });
  } catch (err) {
    console.warn("[bazaar] 402index submission error", {
      endpointId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
