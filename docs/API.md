# API Reference

Base URL: `http://localhost:3001` (or your deployment URL)

## Authentication

When `AUTH_REQUIRED=true`, all endpoints except `/health` and `/auth/*`
require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt-token>
```

Obtain a token via `POST /auth/login` or `POST /auth/register`.

---

## Auth

### POST /auth/register
Create a new user + org.

```json
{
  "email": "alice@example.com",
  "password": "min-8-chars",
  "orgName": "Acme Corp"
}
```

**Response 201:**
```json
{
  "token": "eyJ...",
  "user": { "id": "...", "orgId": "...", "email": "...", "role": "owner" }
}
```

### POST /auth/login
```json
{ "email": "alice@example.com", "password": "..." }
```

**Response 200:** Same shape as register.
**Response 401:** `{"error":"invalid_credentials"}`

### GET /auth/me
Returns the decoded JWT principal (or `authEnabled:false` in dev mode).

---

## Data Plane

### POST /uploads
Multipart file upload (CSV or XLSX, max 50MB).

```bash
curl -X POST /uploads -F "file=@data.csv" -H "Authorization: Bearer ..."
```

### POST /sources
```json
{ "kind": "csv", "name": "Sales", "uploadId": "<uuid>" }
```
or
```json
{
  "kind": "postgres",
  "name": "Prod DB",
  "connection": {
    "host": "db.example.com", "port": 5432,
    "database": "analytics", "user": "reader",
    "password": "...", "ssl": true
  }
}
```

### POST /datasets
```json
{ "sourceId": "<uuid>", "name": "All sales", "query": "SELECT * FROM sales" }
```

### POST /datasets/:id/preview
```json
{ "limit": 1000 }
```
**Response:** `{ columns, rows, truncated, profile }`

---

## Chart Engine

### POST /recommend-chart
```json
{ "fields": [...], "rowCount": 10000, "intent": "auto" }
```
**Response:** `{ recommendations: [{chart, score, reason}], source, fallbackReason }`

### POST /charts/auto-encode
```json
{ "profile": {...}, "chart": "line", "maxMeasures": 4 }
```
**Response:** `{ chart, encoding }`

### POST /charts/compute
```json
{ "spec": { "chart": "bar", "encoding": {...} }, "rows": [...] }
```
**Response:** `{ rows, columns, colors, spec }`

### POST /charts/series-stats
```json
{ "values": [1,2,3,...], "period": 7, "horizon": 12 }
```
**Response:** `{ decomposition, anomalies, forecast }`

---

## Dashboards

### POST /dashboards
### GET /dashboards
### GET /dashboards/:id
### PUT /dashboards/:id
### DELETE /dashboards/:id

---

## Exports

### POST /exports
Stream an export as an attachment.
```json
{ "target": { "kind": "dataset", "datasetId": "..." }, "format": "csv" }
```

### POST /exports/save
Save to disk, return metadata.

### GET /exports/:id
Download a previously saved export.

---

## Schedules

### POST /schedules
```json
{
  "name": "Daily sales",
  "cron": "0 9 * * *",
  "target": { "kind": "dataset", "datasetId": "..." },
  "format": "xlsx",
  "delivery": { "kind": "email", "to": "team@example.com" },
  "enabled": true
}
```

### GET /schedules
### PATCH /schedules/:id
### DELETE /schedules/:id
### POST /schedules/:id/run-now

---

## Health

### GET /health
```json
{ "status": "ok", "aiEnabled": false, "authRequired": true, "dataDir": "/data" }
```
