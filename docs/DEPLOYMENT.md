# Deployment Guide

## Quick Start (Docker Compose)

```bash
# 1. Clone the repo
git clone https://github.com/vinayakss007/reports-genrator.git
cd reports-genrator

# 2. Configure production environment
cp .env.production .env.production.local
# Edit .env.production.local with real values (see below)

# 3. Generate secrets
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")" >> .env.production.local
echo "STORAGE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env.production.local

# 4. Build and run
docker compose --env-file .env.production.local up -d --build

# 5. Verify
curl http://localhost:3001/health
# {"status":"ok","aiEnabled":false,"authRequired":true,"dataDir":"/data"}
```

## Architecture

```
┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Nginx     │  (static SPA + reverse proxy)
└─────────────┘     └──────┬──────┘
                           │ /api/*
                    ┌──────▼──────┐
                    │  Fastify    │  (Node.js API)
                    │  + JWT Auth │
                    │  + Rate Lim │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ /data/   │ │ Postgres │ │ SMTP     │
        │ store    │ │ (source) │ │ (email)  │
        └──────────┘ └──────────┘ └──────────┘
```

## Environment Variables

### Required for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH_REQUIRED` | Enable JWT auth on all routes | `true` |
| `JWT_SECRET` | 64-byte hex string for signing JWTs | `<128 hex chars>` |
| `STORAGE_ENCRYPTION_KEY` | 32-byte hex string for encrypting secrets | `<64 hex chars>` |
| `WEB_ORIGIN` | CORS origin for the web app | `https://app.example.com` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3001` | HTTP port |
| `DATA_DIR` | `./data` | Persistent storage directory |
| `LOG_LEVEL` | `info` | Fastify log level |
| `AI_ENABLED` | `false` | Enable AI sidecar |
| `AI_PROVIDER` | `none` | `none` / `openai` |
| `OPENAI_API_KEY` | — | Required when `AI_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `AI_TIMEOUT_MS` | `1500` | AI call timeout |
| `RATE_LIMIT_MAX` | `300` | Requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window |
| `SMTP_HOST` | — | SMTP server for email delivery |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP auth user |
| `SMTP_PASS` | — | SMTP auth password |
| `SMTP_FROM` | `reports@localhost` | From address |
| `SMTP_SECURE` | `false` | TLS on connect |
| `KEY_SOURCE` | `local` | `local` or `kms` |
| `KMS_KEY_ARN` | — | AWS KMS key ARN |
| `KMS_REGION` | — | AWS region |

## Data Persistence

All state is stored under `DATA_DIR`:

```
/data/
├── store.json            # Metadata (sources, datasets, dashboards, users, orgs)
├── .dev-encryption-key   # Auto-generated dev key (production: use STORAGE_ENCRYPTION_KEY)
├── .jwt-secret           # Auto-generated dev JWT secret (production: use JWT_SECRET)
├── audit.log             # Append-only JSONL audit trail
├── uploads/              # Uploaded CSV/XLSX files
│   └── <uuid>.<ext>
└── exports/              # Saved exports, per-org subdirectories
    └── <orgId>/
        └── <uuid>.<ext>
```

**Backup strategy:** snapshot the entire `DATA_DIR` directory. The
`store.json` is atomically written (write-temp-then-rename) so a
filesystem snapshot is always consistent.

## Security Checklist

- [ ] Set `AUTH_REQUIRED=true`
- [ ] Generate and set `JWT_SECRET` (64 bytes)
- [ ] Generate and set `STORAGE_ENCRYPTION_KEY` (32 bytes)
- [ ] Set `WEB_ORIGIN` to your actual domain
- [ ] Use HTTPS (terminate TLS at a load balancer or nginx)
- [ ] Set `RATE_LIMIT_MAX` appropriate to your traffic
- [ ] Mount `DATA_DIR` on encrypted storage
- [ ] Rotate JWT_SECRET periodically (existing tokens expire in 12h)
- [ ] Review audit.log for unauthorized access attempts

## Scaling

The v1 deployment is single-process by design. To scale:

1. **Database:** Replace `JsonStore` with Postgres. The `Storage` class
   is the seam; implement the same interface against `pg`.
2. **Queue:** Replace `node-cron` Scheduler with BullMQ + Redis. The
   `Scheduler` class API is the seam.
3. **Horizontal API:** Once state is in Postgres + Redis, run multiple
   API replicas behind a load balancer.
4. **Object storage:** Move uploads and exports to S3/GCS. The
   connector and export pipelines accept file paths; swap for
   stream-to-S3 writes.

## Monitoring

- **Health endpoint:** `GET /health` returns `{"status":"ok",...}`
- **Rate limit headers:** `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`
- **Audit log:** Append-only JSONL at `DATA_DIR/audit.log`
- **AI telemetry:** The gateway emits `{call, mode, reason, latencyMs}` events via the telemetry sink (wire to your metrics pipeline by calling `setTelemetrySink()`)
