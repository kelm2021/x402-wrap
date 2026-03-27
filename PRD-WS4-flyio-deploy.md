# Workstream 4: Fly.io Deployment

## Goal
Deploy x402-wrap proxy publicly to Fly.io. Redis via Upstash (external, TLS). No Postgres yet — that's WS5.

## Constraints
- Fly.io app (NOT Vercel — we need persistent server, not serverless)
- Upstash Redis for REDIS_URL (free tier works)
- App name: `x402-wrap` (or `x402-wrap-proxy` if taken)
- Region: `iad` (us-east) or nearest
- Port: 3402 (as configured in env.ts)

## Tasks

### 1. Dockerfile
Create `Dockerfile` at project root:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3402
CMD ["node", "dist/index.js"]
```
Note: must copy tsconfig.json and src/ and run `npm run build` (tsc).

### 2. .dockerignore
```
node_modules
.env
*.local
dist
.git
tests
```

### 3. fly.toml
```toml
app = "x402-wrap"
primary_region = "iad"

[build]

[http_service]
  internal_port = 3402
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

### 4. Environment secrets to configure on Fly.io
Document these in README and in a `fly-secrets.example.sh`:
```bash
fly secrets set REDIS_URL="<upstash-redis-tls-url>"
fly secrets set ENCRYPTION_KEY="<32-byte-hex>"
fly secrets set BASE_URL="https://x402-wrap.fly.dev"
fly secrets set NETWORK="base-sepolia"
fly secrets set CDP_API_KEY="<optional>"
```

### 5. CI: GitHub Actions (optional but nice)
If time allows, add `.github/workflows/fly-deploy.yml` that builds and deploys on push to main.

### 6. Update README.md
Add a "Deploy to Fly.io" section:
- `fly launch` instructions
- `fly secrets set` commands
- `fly deploy`
- How to test the live endpoint

## Environment Notes
- REDIS_URL must be the Upstash TLS URL format: `rediss://default:<password>@<host>:6380`
- ENCRYPTION_KEY must be 32 bytes hex (64 hex chars) — can generate with `openssl rand -hex 32`
- BASE_URL must match the deployed fly.dev URL

## Done When
- `docker build . -t x402-wrap` succeeds locally
- `fly.toml` is valid and documents the app config
- `fly-secrets.example.sh` lists all required secrets
- README.md has deploy instructions
- (Bonus) GitHub Actions workflow deploys on push to main

## Important
- Do NOT actually deploy to Fly.io — just prepare all deployment artifacts
- The actual `fly deploy` command needs live credentials which we'll run manually
- Focus on getting the Docker build working and configs correct
