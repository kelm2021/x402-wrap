import type { Context } from "hono";

import { decryptHeaders } from "./crypto.js";
import type { EndpointConfig } from "./types.js";

const HOP_BY_HOP_HEADERS = new Set([
  "authorization",
  "host",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-payment",
  "x-real-ip",
]);

function buildTargetUrl(c: Context, originUrl: string): string {
  const endpointId = c.req.param("endpointId");
  const prefix = `/p/${endpointId}`;
  const requestUrl = new URL(c.req.url);
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length)
    : "";
  const target = new URL(originUrl);
  const normalizedPath = suffix || "";

  target.pathname = `${target.pathname.replace(/\/$/, "")}${normalizedPath}`;
  target.search = requestUrl.search;

  return target.toString();
}

export async function forwardRequest(c: Context, config: EndpointConfig): Promise<Response> {
  const targetUrl = buildTargetUrl(c, config.originUrl);
  const headers = new Headers();
  const body = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body;

  for (const [key, value] of c.req.raw.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  if (config.encryptedHeaders) {
    const originHeaders = decryptHeaders(config.encryptedHeaders);
    for (const [key, value] of Object.entries(originHeaders)) {
      headers.set(key, value);
    }
  }

  const requestInit = {
    method: c.req.method,
    headers,
    body,
    ...(body ? { duplex: "half" } : {}),
    redirect: "manual",
  } as RequestInit & { duplex?: "half" };

  const upstream = await fetch(targetUrl, requestInit);

  // Re-wrap in a mutable Response so downstream middleware (e.g. CORS) can set headers
  const mutableHeaders = new Headers(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: mutableHeaders,
  });
}
