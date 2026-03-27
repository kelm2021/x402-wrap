import Redis from "ioredis";

import type { EndpointConfig } from "./types.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
export const redis = new Redis(redisUrl, {
  lazyConnect: true,
});

export async function saveEndpoint(endpointId: string, config: EndpointConfig): Promise<void> {
  await redis.set(`endpoint:${endpointId}`, JSON.stringify(config));
}

export async function getEndpoint(endpointId: string): Promise<EndpointConfig | null> {
  const raw = await redis.get(`endpoint:${endpointId}`);
  return raw ? (JSON.parse(raw) as EndpointConfig) : null;
}
