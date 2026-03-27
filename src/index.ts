import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { getPort } from "./lib/env.js";
import { discoveryRoute } from "./routes/discovery.js";
import { proxyRoute } from "./routes/proxy.js";
import { registerRoute } from "./routes/register.js";
import { usageRoute } from "./routes/usage.js";

try {
  const dotenv = await import("dotenv");
  dotenv.config();
} catch {
  // Optional in test environments.
}

export function createApp() {
  const app = new Hono();

  app.get("/", (c) => c.json({ ok: true, service: "x402-wrap" }));
  app.route("/.well-known/x402.json", discoveryRoute);
  app.route("/register", registerRoute);
  app.route("/p", proxyRoute);
  app.route("/usage", usageRoute);

  return app;
}

export function startServer(port = getPort()) {
  const app = createApp();
  return serve({
    fetch: app.fetch,
    port,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = getPort();
  startServer(port);
  console.log(`x402-wrap listening on http://localhost:${port}`);
}
