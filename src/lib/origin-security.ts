import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

const BLOCKED_IPV4 = [
  "0.",
  "10.",
  "127.",
  "169.254.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
];

function allowPrivateOrigins(): boolean {
  return process.env.ALLOW_PRIVATE_ORIGINS === "true";
}

function ensureHttpUrl(originUrl: string): URL {
  let url: URL;
  try {
    url = new URL(originUrl);
  } catch {
    throw new Error("originUrl must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("originUrl must use http or https");
  }

  if (url.username || url.password) {
    throw new Error("originUrl cannot include embedded credentials");
  }

  return url;
}

function isBlockedIpv4(address: string): boolean {
  return BLOCKED_IPV4.some((prefix) => address.startsWith(prefix));
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "::"
  );
}

function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return false;
}

export function getVerificationPath(token: string): string {
  return `/.well-known/x402-wrap-verification/${token}`;
}

export function assertAllowedOrigin(originUrl: string): URL {
  const url = ensureHttpUrl(originUrl);
  if (allowPrivateOrigins()) return url;

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal")) {
    throw new Error("originUrl host is not allowed");
  }

  if (net.isIP(hostname)) {
    throw new Error("originUrl cannot use a direct IP address");
  }

  return url;
}

export async function assertSafeResolvedOrigin(originUrl: string): Promise<URL> {
  const url = assertAllowedOrigin(originUrl);
  if (allowPrivateOrigins()) return url;

  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error("originUrl hostname did not resolve");
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error("originUrl resolved to a blocked address");
    }
  }

  return url;
}

export function buildVerificationUrl(originUrl: string, token: string): string {
  const url = ensureHttpUrl(originUrl);
  url.pathname = getVerificationPath(token);
  url.search = "";
  url.hash = "";
  return url.toString();
}
