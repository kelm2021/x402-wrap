#!/usr/bin/env bash
# Run these after `fly apps create x402-wrap` and before `fly deploy`
# Generate ENCRYPTION_KEY with: openssl rand -hex 32

fly secrets set \
  REDIS_URL="rediss://default:<password>@<host>.upstash.io:6380" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  BASE_URL="https://x402-wrap.fly.dev" \
  NETWORK="base-sepolia" \
  CDP_API_KEY="<your-cdp-api-key>"

# Switch to mainnet when ready:
# fly secrets set NETWORK="base" BASE_URL="https://x402-wrap.fly.dev"
