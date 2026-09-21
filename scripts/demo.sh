#!/usr/bin/env bash
# Walks the four demo scenarios against a running server.
#   ./scripts/demo.sh [api-url]
set -euo pipefail

API="${1:-http://localhost:3001}"
STAMP=$(date +%s)

mode() {
  curl -sS -X POST "$API/test-receiver/config" -H 'content-type: application/json' \
    -d "{\"mode\":\"$1\",\"failureStatus\":${2:-503},\"resetState\":true}" > /dev/null
  echo "receiver mode: $1 ${2:-}"
}

submit() {
  curl -sS -X POST "$API/events" -H 'content-type: application/json' \
    -d "{\"eventId\":\"$1\",\"type\":\"incident.created\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"payload\":{\"incidentId\":\"inc_456\",\"severity\":\"high\"}}"
  echo
}

show() {
  curl -sS "$API/events/$1" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(f"  {d[\"eventId\"]}: {d[\"status\"]}  attempts={d[\"attemptCount\"]}/{d[\"maxAttempts\"]}  next={d[\"nextAttemptAt\"]}")
for a in d["attempts"]:
    print(f"    attempt {a[\"attemptNumber\"]}: {a[\"status\"]} {a[\"httpStatus\"] or a[\"errorType\"] or \"\"}")'
}

echo "== Scenario 1: success =="
mode SUCCESS
submit "evt_demo_success_$STAMP"; sleep 3; show "evt_demo_success_$STAMP"

echo; echo "== Scenario 2: temporary failure, then success =="
mode FAIL_ONCE 503
submit "evt_demo_retry_$STAMP"; sleep 3; show "evt_demo_retry_$STAMP"
echo "  (waiting for the scheduled retry…)"; sleep 20; show "evt_demo_retry_$STAMP"

echo; echo "== Scenario 3: retry budget exhausted =="
mode FAIL_ALWAYS 503
submit "evt_demo_exhausted_$STAMP"; sleep 50; show "evt_demo_exhausted_$STAMP"

echo; echo "== Scenario 3b: permanent failure =="
mode FAIL_ALWAYS 400
submit "evt_demo_permanent_$STAMP"; sleep 3; show "evt_demo_permanent_$STAMP"

echo; echo "== Scenario 4: duplicate submissions =="
mode SUCCESS
for _ in 1 2 3; do submit "evt_demo_duplicate_$STAMP"; done
sleep 3; show "evt_demo_duplicate_$STAMP"
echo "  → 3 ingestion requests, 1 logical event, 1 delivery job, 1 attempt"
