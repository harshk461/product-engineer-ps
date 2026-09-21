# Caygnus Webhook Retry Engine

A small, production-minded webhook delivery platform: idempotent ingestion, persistent
scheduling in MySQL, bounded retries with failure classification, crash recovery, a
complete attempt history, and a real-time dashboard to watch all of it happen.

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENT — Next.js dashboard                                  │
│  Events │ Delivery status │ Attempts │ Retries │ Failures    │
└──────────────────────────┬───────────────────────────────────┘
                     REST  │  WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  SERVER — NestJS                                             │
│    POST /events → EventsService ──┐                          │
│                                   ▼                          │
│                                 MySQL  ◄── source of truth   │
│                                   │                          │
│                     DeliveryWorker (claims due jobs)         │
│                                   ▼                          │
│                     DeliveryService (state machine)          │
│                                   ▼                          │
│                     WebhookClient → receiver                 │
│                                                              │
│  RealtimeGateway → dashboard (observability only)            │
└──────────────────────────────────────────────────────────────┘
```

**The database is the source of truth.** There is no in-memory queue. The websocket
layer is pure observability: if the dashboard disconnects, nothing is lost, and on
reconnect it re-reads authoritative state over REST.

---

## Quick start

### With Docker (MySQL included)

```bash
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:3000
- API: http://localhost:3001
- MySQL: localhost:3307 (`webhook` / `webhook`)

The server container runs the migration before starting.

### Locally

Requires Node 24 and a MySQL 8 database.

```bash
npm run install:all

# create the schema
cp .env.example .env            # edit DB_* to point at your MySQL
npm run migration:run

npm run dev                     # server on :3001, dashboard on :3000
```

To try it without MySQL at all, the server also runs on SQLite:

```bash
cd apps/server
DB_DRIVER=sqlite DB_FILE=./demo.sqlite DB_SYNCHRONIZE=true npm start
```

---

## Configuration

Every value below is an environment variable; see [.env.example](.env.example) for the
full list with defaults.

| Variable | Purpose |
|---|---|
| `MAX_ATTEMPTS` | Total attempts per event, including the first (default 3) |
| `RETRY_DELAY_1_MS` / `RETRY_DELAY_2_MS` | Backoff after attempt 1 / attempt 2. Production values are 5 min and 30 min; `.env.example` ships 15 s / 30 s so retries are watchable in a demo |
| `RETRY_DELAYS_MS` | Optional comma-separated override for the whole backoff sequence |
| `WEBHOOK_TARGET_URL` | Where deliveries go. Defaults to the bundled test receiver |
| `WEBHOOK_TIMEOUT_MS` | Per-attempt HTTP timeout |
| `WORKER_POLL_INTERVAL_MS` | How often the worker asks the database for due jobs |
| `WORKER_LEASE_TIMEOUT_MS` | A job held in `DELIVERING` longer than this is treated as a crashed worker |
| `WORKER_ENABLED` | Set `false` to run an API-only instance with no delivery worker |

---

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/events` | Ingest an event. Always `202`; the response carries `duplicate: true/false` |
| `GET` | `/events` | List events with status, attempt count, next attempt and last error |
| `GET` | `/events/:eventId` | Event detail including payload and full attempt history |
| `GET` | `/events/:eventId/attempts` | Attempt history alone |
| `GET` | `/dashboard/stats` | Aggregate statistics |
| `GET` | `/health` | Liveness, database reachability, worker status, active retry policy |
| `POST` | `/test-receiver/webhook` | Demo receiver (the default delivery target) |
| `GET` / `POST` | `/test-receiver/config` | Read / change the demo receiver's behaviour |
| WS | `/realtime` | Live activity and statistics |

Ingest an event:

```bash
curl -X POST http://localhost:3001/events \
  -H 'content-type: application/json' \
  -d '{
    "eventId": "evt_123",
    "type": "incident.created",
    "occurredAt": "2026-09-15T10:00:00Z",
    "payload": { "incidentId": "inc_456", "severity": "high" }
  }'
```

### Real-time events

`event.accepted`, `duplicate.event`, `delivery.started`, `delivery.succeeded`,
`delivery.failed`, `delivery.retry_scheduled`, `delivery.exhausted`,
`delivery.recovered`, `receiver.delivery_received`, `receiver.config_changed`.

Each message is published on the `activity` channel and under its own name:

```json
{
  "type": "delivery.retry_scheduled",
  "eventId": "evt_123",
  "status": "RETRYING",
  "attemptNumber": 1,
  "maxAttempts": 3,
  "httpStatus": 503,
  "attemptsRemaining": 2,
  "nextAttemptAt": "2026-09-15T10:05:00.000Z",
  "message": "Retry 2/3 scheduled for 2026-09-15T10:05:00.000Z",
  "emittedAt": "2026-09-15T10:00:03.114Z"
}
```

---

## How it works

### Idempotency

`events.eventId` and `delivery_jobs.eventId` both carry a `UNIQUE` index. Ingestion
opens a transaction, inserts the event and its delivery job together, and commits. A
duplicate submission does not pre-check for existence — it attempts the insert, catches
the unique violation, and returns the committed original. Concurrent duplicates
therefore collapse correctly: the database picks the winner, not the application.

A later submission with a different payload never overwrites the first accepted event.

### Persistent scheduling

`delivery_jobs` *is* the queue:

```sql
status IN ('PENDING','RETRYING') AND nextAttemptAt <= NOW()
```

The worker reads a batch of candidate ids, then claims each one with a conditional
update:

```sql
UPDATE delivery_jobs
   SET status = 'DELIVERING', attemptCount = attemptCount + 1, lockedAt = ?, lockedBy = ?
 WHERE id = ? AND status IN ('PENDING','RETRYING') AND nextAttemptAt <= ?
```

Exactly one worker can see `affected = 1`, so running several workers is safe, and no
lock is held while the HTTP request is in flight. The attempt counter increments at
claim time, which is what keeps retries bounded even across crashes.

### Retry classification

| Outcome | Result |
|---|---|
| `2xx` | `DELIVERED` |
| `408`, `429`, any `5xx` | Retryable — consumes an attempt, schedules the next |
| Other `4xx` (400, 401, 403, 404, 405, 422…) | Permanent — `FAILED` immediately, no retry |
| Timeout, connection refused, DNS failure, reset | Retryable — the receiver never decided |

Three attempts total by default: attempt 1 → wait → attempt 2 → wait → attempt 3 → `FAILED`.

### Crash recovery

A worker that dies mid-delivery leaves its job in `DELIVERING` with a stale `lockedAt`.
Each tick, the worker sweeps jobs whose lease expired, closes the abandoned attempt row
with `WORKER_CRASH`, and either requeues the job or terminates it if the attempt budget
is spent.

Delivery is therefore **at-least-once**: a receiver can see the same event twice, which
is why every request carries `X-Webhook-Event-Id` for receiver-side idempotency (and
`X-Webhook-Signature`, an HMAC-SHA256 of the body).

### Dashboard consistency

The dashboard fetches state over REST on load and again on every websocket reconnect.
Live messages update rows immediately and trigger a debounced authoritative re-read.
A missed message can cost liveness, never correctness.

---

## Demo scenarios

Open the dashboard, pick a mode under **Test receiver**, then submit an event.

| Mode | What you see |
|---|---|
| `SUCCESS` | `PENDING` → attempt 1 → `200` → `DELIVERED` |
| `FAIL_ONCE` (503) | attempt 1 → `503` → `RETRYING` with a live countdown → attempt 2 → `200` → `DELIVERED` |
| `FAIL_ALWAYS` (503) | three attempts, all `503`, then `FAILED` — retry limit reached |
| `FAIL_ALWAYS` (400) | one attempt, `400`, then `FAILED` — permanent, no retry scheduled |
| Any mode, **Submit same ID again** | Three submissions, one event, one delivery job |

`scripts/demo.sh` runs all of these from the command line against a running server.

---

## Testing

```bash
npm test          # from the repo root, or: cd apps/server && npm test
```

61 tests across 8 suites, covering successful delivery, retry then success, exhaustion
after exactly `MAX_ATTEMPTS`, permanent failure without retry, transport-failure
classification, repeated and concurrent duplicate submissions, payload immutability,
single-claim guarantees, crash recovery and bounded retries across repeated crashes,
websocket transitions, and REST-authoritative recovery while no dashboard is connected.

The suite runs on an in-memory SQLite database and needs no infrastructure. Tests drive
the worker tick by tick rather than sleeping, so the whole suite finishes in ~3 seconds.

---

## Project layout

```
apps/server/src/
  events/         ingestion, idempotency, event queries
  delivery/       state machine, worker, job claiming, HTTP client, retry policy
  attempts/       the immutable attempt log
  realtime/       websocket gateway and the publish seam
  dashboard/      aggregate statistics
  test-receiver/  demo receiver (not part of the engine)
  database/       migrations, datasource, transaction runner
  metrics/, config/, health/

apps/client/
  app/            dashboard and event detail pages
  components/     stat tiles, event table, activity feed, lifecycle view, controls
  hooks/          REST + websocket state
  lib/, types/
```
