#!/bin/sh
# Production healthcheck script.
# Returns 0 if the API is healthy, 1 otherwise.
# Usage: ./scripts/healthcheck.sh [url]

URL="${1:-http://localhost:3001/health}"

RESPONSE=$(curl -sf --max-time 5 "$URL" 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "FAIL: API not reachable at $URL"
  exit 1
fi

STATUS=$(echo "$RESPONSE" | grep -o '"status":"ok"')
if [ -z "$STATUS" ]; then
  echo "FAIL: API returned unhealthy response: $RESPONSE"
  exit 1
fi

echo "OK: $RESPONSE"
exit 0
