import { Hono } from "hono";
import { getUsage } from "../lib/usage.js";

export const usageRoute = new Hono();

usageRoute.get("/:endpointId", async (c) => {
  const endpointId = c.req.param("endpointId");
  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;

  const summary = await getUsage(endpointId, since);
  return c.json(summary);
});
