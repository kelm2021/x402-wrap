const DEFAULT_PORT = 3402;

export function getPort(): number {
  const raw = process.env.PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

export function getBaseUrl(): string {
  return process.env.BASE_URL ?? `http://localhost:${getPort()}`;
}

export function getNetwork(): string {
  return process.env.NETWORK ?? "base-sepolia";
}

export function getFacilitatorUrl(): string | undefined {
  return process.env.FACILITATOR_URL;
}
