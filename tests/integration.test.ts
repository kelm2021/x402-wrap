import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import { createServer } from "node:http";

const redisData = new Map<string, string>();
const verifyPaymentHeaderMock = vi.fn();
const settlePaymentHeaderMock = vi.fn().mockResolvedValue({ isValid: true });

// Mock the redis module directly so app and tests share the same store
vi.mock("../src/lib/redis.js", async () => {
  return {
    getClient: async () => ({
      get: async (key: string) => redisData.get(key) ?? null,
      set: async (key: string, value: string) => { redisData.set(key, value); return "OK"; },
      incr: async (key: string) => { const v = parseInt(redisData.get(key) ?? "0", 10) + 1; redisData.set(key, String(v)); return v; },
      expire: async () => 1,
      scan: async () => ["0", [...redisData.keys()]],
      mget: async (...keys: string[]) => keys.map((k) => redisData.get(k) ?? null),
    }),
    saveEndpoint: async (endpointId: string, config: unknown) => {
      redisData.set(`endpoint:${endpointId}`, JSON.stringify(config));
    },
    saveEndpointRecord: async (endpointId: string, record: unknown) => {
      redisData.set(`endpoint:${endpointId}`, JSON.stringify(record));
    },
    getEndpoint: async (endpointId: string) => {
      const raw = redisData.get(`endpoint:${endpointId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.status && parsed.status !== "active" ? null : parsed;
    },
    getEndpointRecord: async (endpointId: string) => {
      const raw = redisData.get(`endpoint:${endpointId}`);
      return raw ? JSON.parse(raw) : null;
    },
    listAllEndpoints: async () => {
      const results = [];
      for (const [key, value] of redisData.entries()) {
        if (key.startsWith("endpoint:")) {
          results.push({ endpointId: key.replace("endpoint:", ""), config: JSON.parse(value), createdAt: null });
        }
      }
      return results;
    },
  };
});

vi.mock("x402/types", async () => {
  const actual = await vi.importActual<typeof import("x402/types")>("x402/types");
  return {
    ...actual,
  };
});

describe("integration", () => {
  let createApp: typeof import("../src/index.js").createApp;
  let encryptHeaders: typeof import("../src/lib/crypto.js").encryptHeaders;
  let decryptHeaders: typeof import("../src/lib/crypto.js").decryptHeaders;
  let x402Internals: typeof import("../src/middleware/x402.js").x402Internals;
  let actualVerifyPaymentHeader: typeof import("../src/middleware/x402.js").verifyPaymentHeader;
  let actualSettlePaymentHeader: typeof import("../src/middleware/x402.js").settlePaymentHeader; // eslint-disable-line @typescript-eslint/no-unused-vars
  let appServer: { close: (cb?: () => void) => void; address?: () => unknown } | undefined;
  let upstreamServer: ReturnType<typeof createServer>;
  let baseUrl: string;
  let upstreamUrl: string;
  let upstreamRequests: Array<{ headers: Headers; body: string }>;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY =
      "0000000000000000000000000000000000000000000000000000000000000000";
    process.env.NETWORK = "base-sepolia";
    process.env.ALLOW_PRIVATE_ORIGINS = "true";

    ({ createApp } = await import("../src/index.js"));
    ({ encryptHeaders, decryptHeaders } = await import("../src/lib/crypto.js"));
    ({ x402Internals, verifyPaymentHeader: actualVerifyPaymentHeader, settlePaymentHeader: actualSettlePaymentHeader } = await import(
      "../src/middleware/x402.js"
    ));
  });

  beforeEach(async () => {
    redisData.clear();
    verifyPaymentHeaderMock.mockReset();
    settlePaymentHeaderMock.mockReset();
    settlePaymentHeaderMock.mockResolvedValue({ isValid: true });
    x402Internals.verifyPaymentHeader = verifyPaymentHeaderMock;
    x402Internals.settlePaymentHeader = settlePaymentHeaderMock;
    upstreamRequests = [];

    upstreamServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        if (req.url?.startsWith("/.well-known/x402-wrap-verification/")) {
          const token = req.url.split("/").pop() ?? "";
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(token);
          return;
        }

        upstreamRequests.push({
          headers: new Headers(
            Object.entries(req.headers)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string")
              .map(([key, value]) => [key, value] as [string, string]),
          ),
          body: Buffer.concat(chunks).toString("utf8"),
        });

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });

    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Failed to bind upstream test server");
    }

    upstreamUrl = `http://127.0.0.1:${upstreamAddress.port}`;

    appServer = serve({ fetch: createApp().fetch, port: 0 }) as typeof appServer;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const currentAppServer = appServer;
    if (!currentAppServer) {
      throw new Error("Failed to create app server");
    }

    const appAddress = currentAppServer.address?.();
    if (
      !appAddress ||
      typeof appAddress === "string" ||
      typeof appAddress !== "object" ||
      !("port" in appAddress)
    ) {
      throw new Error("Failed to bind app test server");
    }

    baseUrl = `http://127.0.0.1:${appAddress.port}`;
    process.env.BASE_URL = baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      upstreamServer.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve) => {
      appServer?.close();
      setTimeout(resolve, 10);
    });
  });

  afterAll(() => {
    x402Internals.verifyPaymentHeader = actualVerifyPaymentHeader;
    x402Internals.settlePaymentHeader = actualSettlePaymentHeader;
    vi.restoreAllMocks();
  });

  it("POST /register with valid body returns endpointId and proxyUrl", async () => {
    const response = await fetch(`${baseUrl}/register-intent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        originUrl: "https://api.example.com",
        price: "0.01",
        walletAddress: "0x1234567890123456789012345678901234567890",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.endpointId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(json.status).toBe("pending_verification");
    expect(json.verificationToken).toBeTruthy();
    expect(json.verificationPath).toContain("/.well-known/x402-wrap-verification/");
    expect(redisData.get(`endpoint:${json.endpointId}`)).toBeTruthy();
  });

  it("POST /register-intent rejects blocked origins", async () => {
    process.env.ALLOW_PRIVATE_ORIGINS = "false";

    const response = await fetch(`${baseUrl}/register-intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originUrl: "http://localhost:8080",
        price: "0.01",
        walletAddress: "0x1234567890123456789012345678901234567890",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("not allowed") });
    process.env.ALLOW_PRIVATE_ORIGINS = "true";
  });

  it("POST /activate before verification returns 409", async () => {
    const createResponse = await fetch(`${baseUrl}/register-intent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0x1234567890123456789012345678901234567890",
      }),
    });
    const created = await createResponse.json();

    const response = await fetch(`${baseUrl}/activate/${created.endpointId}`, { method: "POST" });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("verification") });
  });

  it("GET unknown endpoint returns 404", async () => {
    const response = await fetch(`${baseUrl}/p/unknown/test`);
    expect(response.status).toBe(404);
  });

  it("GET known endpoint without X-PAYMENT returns 402 with x402Version 1", async () => {
    redisData.set(
      "endpoint:known",
      JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "active",
        visibility: "public",
      }),
    );

    const response = await fetch(`${baseUrl}/p/known/test`);

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      x402Version: 1,
      error: "Payment required",
    });
  });

  it("GET paid request proxies and returns upstream response", async () => {
    redisData.set(
      "endpoint:valid",
      JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "active",
        visibility: "public",
      }),
    );
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/p/valid/test?foo=bar`, {
      headers: { "X-PAYMENT": JSON.stringify({ x402Version: 1 }) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: "/test?foo=bar" });
    expect(verifyPaymentHeaderMock).toHaveBeenCalledTimes(1);
  });

  it("strips X-PAYMENT and Authorization before forwarding to origin", async () => {
    redisData.set(
      "endpoint:valid",
      JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "active",
        visibility: "public",
      }),
    );
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/p/valid/headers`, {
      headers: {
        Authorization: "Bearer secret",
        "X-PAYMENT": JSON.stringify({ x402Version: 1 }),
        "X-Test": "kept",
      },
    });

    expect(response.status).toBe(200);
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0].headers.get("authorization")).toBeNull();
    expect(upstreamRequests[0].headers.get("x-payment")).toBeNull();
    expect(upstreamRequests[0].headers.get("x-test")).toBe("kept");
  });

  it("encrypts origin headers for storage and decrypts them correctly", async () => {
    const headers = { Authorization: "Bearer upstream", "X-Origin-Key": "abc123" };
    const encrypted = encryptHeaders(headers);
    const decrypted = decryptHeaders(encrypted);

    expect(encrypted.ciphertext).not.toContain("Bearer upstream");
    expect(decrypted).toEqual(headers);
  });

  it("injects decrypted origin headers into upstream requests", async () => {
    redisData.set(
      "endpoint:with-headers",
      JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0xabc",
        pathPattern: "*",
        encryptedHeaders: encryptHeaders({ "X-Origin-Key": "server-secret" }),
        status: "active",
        visibility: "public",
      }),
    );
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/p/with-headers/test`, {
      headers: { "X-PAYMENT": JSON.stringify({ x402Version: 1 }) },
    });

    expect(response.status).toBe(200);
    expect(upstreamRequests[0].headers.get("x-origin-key")).toBe("server-secret");
  });

  it("verify then activate promotes an intent into an active endpoint", async () => {
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const createResponse = await fetch(`${baseUrl}/register-intent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0x1234567890123456789012345678901234567890",
      }),
    });
    const created = await createResponse.json();

    const verifyResponse = await fetch(`${baseUrl}/verify/${created.endpointId}`, {
      method: "POST",
    });
    expect(verifyResponse.status).toBe(200);
    expect(await verifyResponse.json()).toMatchObject({ status: "pending_payment", verified: true });

    const activateResponse = await fetch(`${baseUrl}/activate/${created.endpointId}`, {
      method: "POST",
      headers: {
        "X-PAYMENT": JSON.stringify({ x402Version: 1 }),
      },
    });
    expect(activateResponse.status).toBe(200);
    const activated = await activateResponse.json();
    expect(activated.status).toBe("active");
    expect(activated.proxyUrl).toBe(`${baseUrl}/p/${created.endpointId}/*`);

    const proxied = await fetch(`${baseUrl}/p/${created.endpointId}/ready`, {
      headers: { "X-PAYMENT": JSON.stringify({ x402Version: 1 }) },
    });
    expect(proxied.status).toBe(200);
  });

  it("discovery only lists active public endpoints", async () => {
    redisData.set(
      "endpoint:public-active",
      JSON.stringify({
        originUrl: "https://public.example.com",
        price: "0.02",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "active",
        visibility: "public",
      }),
    );
    redisData.set(
      "endpoint:private-active",
      JSON.stringify({
        originUrl: "https://private.example.com",
        price: "0.02",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "active",
        visibility: "private",
      }),
    );
    redisData.set(
      "endpoint:pending",
      JSON.stringify({
        originUrl: "https://pending.example.com",
        price: "0.02",
        walletAddress: "0xabc",
        pathPattern: "*",
        status: "pending_verification",
        visibility: "public",
      }),
    );

    const response = await fetch(`${baseUrl}/.well-known/x402.json`);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.endpoints).toHaveLength(1);
    expect(json.endpoints[0]).toMatchObject({ endpointId: "public-active" });
  });
});
