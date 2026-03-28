import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import { createServer } from "node:http";

const redisData = new Map<string, string>();
const verifyPaymentHeaderMock = vi.fn();

vi.mock("ioredis", () => {
  class MockRedis {
    async get(key: string) {
      return redisData.get(key) ?? null;
    }

    async set(key: string, value: string) {
      redisData.set(key, value);
      return "OK";
    }

    async incr(key: string) {
      const val = parseInt(redisData.get(key) ?? "0", 10) + 1;
      redisData.set(key, String(val));
      return val;
    }

    async expire(_key: string, _ttl: number) {
      return 1;
    }
  }

  return { default: MockRedis };
});

vi.mock("ioredis-mock", () => {
  class MockRedis {
    async get(key: string) {
      return redisData.get(key) ?? null;
    }

    async set(key: string, value: string) {
      redisData.set(key, value);
      return "OK";
    }

    async incr(key: string) {
      const val = parseInt(redisData.get(key) ?? "0", 10) + 1;
      redisData.set(key, String(val));
      return val;
    }

    async expire(_key: string, _ttl: number) {
      return 1;
    }
  }

  return { default: MockRedis };
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
  let appServer: { close: (cb?: () => void) => void; address?: () => unknown } | undefined;
  let upstreamServer: ReturnType<typeof createServer>;
  let baseUrl: string;
  let upstreamUrl: string;
  let upstreamRequests: Array<{ headers: Headers; body: string }>;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY =
      "0000000000000000000000000000000000000000000000000000000000000000";
    process.env.NETWORK = "base-sepolia";

    ({ createApp } = await import("../src/index.js"));
    ({ encryptHeaders, decryptHeaders } = await import("../src/lib/crypto.js"));
    ({ x402Internals, verifyPaymentHeader: actualVerifyPaymentHeader } = await import(
      "../src/middleware/x402.js"
    ));
  });

  beforeEach(async () => {
    redisData.clear();
    verifyPaymentHeaderMock.mockReset();
    x402Internals.verifyPaymentHeader = verifyPaymentHeaderMock;
    upstreamRequests = [];

    upstreamServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
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
    vi.restoreAllMocks();
  });

  it("POST /register with valid body returns endpointId and proxyUrl", async () => {
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-PAYMENT": JSON.stringify({ x402Version: 1 }),
      },
      body: JSON.stringify({
        originUrl: upstreamUrl,
        price: "0.01",
        walletAddress: "0xabc",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.endpointId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(json.proxyUrl).toBe(`${baseUrl}/p/${json.endpointId}/*`);
    expect(redisData.get(`endpoint:${json.endpointId}`)).toBeTruthy();
  });

  it("POST /register without payment returns 402", async () => {
    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ originUrl: upstreamUrl }),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ x402Version: 1 });
  });

  it("POST /register with payment but missing required fields returns 400", async () => {
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-PAYMENT": JSON.stringify({ x402Version: 1 }),
      },
      body: JSON.stringify({ originUrl: upstreamUrl }),
    });

    expect(response.status).toBe(400);
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
      }),
    );
    verifyPaymentHeaderMock.mockResolvedValue({ isValid: true });

    const response = await fetch(`${baseUrl}/p/with-headers/test`, {
      headers: { "X-PAYMENT": JSON.stringify({ x402Version: 1 }) },
    });

    expect(response.status).toBe(200);
    expect(upstreamRequests[0].headers.get("x-origin-key")).toBe("server-secret");
  });
});
