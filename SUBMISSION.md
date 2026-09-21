# Submission notes

## What was built

A two-application monorepo: a NestJS delivery engine backed by MySQL, and a separate
Next.js dashboard that observes and controls it over REST + WebSocket.

```
apps/server   NestJS 11, TypeScript, TypeORM, MySQL 8, socket.io, Jest
apps/client   Next.js 15, React 19, TypeScript, Tailwind, socket.io-client
```

The engine is the product; the dashboard is the observability layer. No delivery logic
lives in the frontend, and the dashboard never holds authoritative state.

---

## Requirement coverage

| Requirement | Where | Notes |
|---|---|---|
| Event ingestion, atomic with job creation | [events.service.ts](apps/server/src/events/events.service.ts) | One transaction creates the event and its delivery job |
| Idempotency enforced by the database | [migration](apps/server/src/database/migrations/1758300000000-InitialSchema.ts), [unique-violation.ts](apps/server/src/common/unique-violation.ts) | `UNIQUE(eventId)` on both `events` and `delivery_jobs`; duplicates are detected by catching the constraint violation, not by a pre-check |
| Three-table model with indexes | [entities](apps/server/src/events/entities/event.entity.ts) | Indexes on `eventId`, `status`, `(status, nextAttemptAt)`, `lockedAt` |
| Explicit state machine, no arbitrary transitions | [delivery-status.enum.ts](apps/server/src/common/delivery-status.enum.ts) | Transition table + `assertTransition`; every transition is asserted before it is written |
| Persistent scheduling, no in-memory queue | [delivery.repository.ts](apps/server/src/delivery/delivery.repository.ts) | `delivery_jobs` is the queue |
| Safe claiming, multi-worker ready | same | Conditional `UPDATE` — exactly one claimer sees `affected = 1` |
| Dedicated webhook client | [webhook.client.ts](apps/server/src/delivery/webhook.client.ts) | Only place that speaks HTTP; returns a normalised result, never throws for a delivery outcome |
| Retry classification | [retry-policy.ts](apps/server/src/delivery/retry-policy.ts) | `2xx` success; `408`/`429`/`5xx` and transport failures retryable; other `4xx` permanent |
| Bounded retries, configurable delays | same + [configuration.ts](apps/server/src/config/configuration.ts) | `MAX_ATTEMPTS`, `RETRY_DELAY_1_MS`, `RETRY_DELAY_2_MS`, optional `RETRY_DELAYS_MS` |
| Immutable attempt history | [attempts.service.ts](apps/server/src/attempts/attempts.service.ts) | Row opened before the request, closed when it settles; `UNIQUE(eventId, attemptNumber)` |
| Real-time events | [realtime.gateway.ts](apps/server/src/realtime/realtime.gateway.ts) | Ten event types; publishing is best-effort and can never fail a delivery |
| Crash recovery | [delivery.service.ts](apps/server/src/delivery/delivery.service.ts) `recoverStaleJobs` | Lease sweep requeues or terminates; abandoned attempts are closed as `WORKER_CRASH` |
| At-least-once + receiver idempotency key | [webhook.client.ts](apps/server/src/delivery/webhook.client.ts) | `X-Webhook-Event-Id` on every request, plus an HMAC signature |
| Dashboard: overview, list, detail, timeline, retry & failure visualisation, idempotency | [apps/client](apps/client) | See below |
| Test receiver with SUCCESS / FAIL_ONCE / FAIL_ALWAYS | [test-receiver](apps/server/src/test-receiver/test-receiver.service.ts) | Configurable failure status and latency |
| Observability metrics | [metrics.service.ts](apps/server/src/metrics/metrics.service.ts), [dashboard.service.ts](apps/server/src/dashboard/dashboard.service.ts) | Counters, HTTP status distribution, delivery latency, worker tick time — no Prometheus stack |
| Tests | [apps/server/test](apps/server/test) | 61 tests, no infrastructure required, no sleep-based timing |

### Dashboard

- **Overview** — five status tiles plus success rate, average delivery latency, attempts
  per event and duplicates ignored. Updates live.
- **Event list** — ID, type, status, attempts `n/3`, created, next attempt with a live
  countdown, last error.
- **Event detail** — the delivery lifecycle drawn as the chain of states the event
  actually went through, a plain-language sentence explaining *why* it is in its current
  state, full attempt history with response bodies, and the payload.
- **Live activity** — websocket feed; seeded from REST history so a freshly opened tab is
  not blank, with live entries above the history divider.
- **Receiver controls** — mode, failure status (retryable vs permanent), response delay.
- **Submit form** — "Submit same ID again" exists specifically to demonstrate idempotency.

---

## Design decisions worth calling out

**The attempt counter increments when the job is claimed, not after the response.**
This is what makes retries bounded across crashes: a worker that dies mid-flight has
still consumed an attempt, so no sequence of crashes can produce unbounded delivery.
It also makes `UNIQUE(eventId, attemptNumber)` hold.

**Claiming is a conditional UPDATE, not a held row lock.** A `SELECT … FOR UPDATE SKIP
LOCKED` would hold a transaction open across the HTTP call. Reading candidate ids and
then claiming each with a guarded `UPDATE` gives the same exclusivity with no lock held
during delivery, and it is portable.

**`events.status` is a projection of the job's status.** It is written by the same
repository that owns the transition, inside the same call, so the list view can be
served from one table without a join. The delivery job remains the authority.

**Duplicate ingestion returns `202`, not `409`.** An at-least-once producer retrying a
submission has done nothing wrong. The response carries `duplicate: true` so a caller
that cares can tell the difference.

**A permanent failure emits one terminal event, exhaustion emits two.** The dashboard
needs to distinguish "the receiver rejected this and always will" from "we ran out of
attempts", which is exactly the difference the specification asks to make visible.

**The websocket publishes through a thin seam** (`RealtimePublisher`) that swallows
errors. A broken socket layer must never be able to fail a delivery.

**Status colours follow a reserved status palette and always ship with an icon and a
written label**, so state is never carried by hue alone.

---

## Verification

Run from the repo root:

```bash
npm run install:all
npm test
```

What I verified on this machine:

- **61/61 tests pass** across 8 suites in ~3 s (SQLite, no infrastructure).
- **Both apps build** — `nest build` and `next build` are clean, as is `tsc --noEmit`
  for each.
- **A live end-to-end run** of the server plus dashboard: all four demo scenarios
  behaved as specified against a real HTTP receiver — success on attempt 1; `503` →
  retry → `200`; three `503`s → `FAILED` with no further scheduling; `400` → `FAILED`
  after one attempt; three submissions of `evt_123` → one event, one job, one attempt,
  original payload preserved. Statistics, health and the websocket feed were correct
  throughout, and the dashboard rendered correctly in both light and dark mode.

**What I could not verify:** the MySQL path specifically. The Docker daemon was not
running on this machine and the local MySQL server's credentials were not available, so
`docker compose up` and `migration:run` were never executed. The engine ran against
SQLite instead. The MySQL DDL, the compose file and the Dockerfiles are written but
unexecuted — please run `docker compose up --build` first and treat that as the
remaining verification step.

Note that concurrency is also exercised differently per driver. On MySQL, concurrent
ingestion means genuinely concurrent InnoDB transactions racing on `UNIQUE(eventId)`.
SQLite has a single writer, so [`TransactionRunner`](apps/server/src/database/transaction.runner.ts)
queues write transactions there; the concurrency test still proves the observable
contract (five overlapping submissions → one event, one job, one accepted response),
but the InnoDB-level race itself is only exercised against MySQL.

---

## What I would do next

- Move the worker to `SELECT … FOR UPDATE SKIP LOCKED` for candidate selection on MySQL,
  keeping the conditional update as the correctness guarantee — a throughput
  optimisation, not a correctness one.
- Add a dead-letter view and a manual "retry now" action for exhausted events.
- Per-endpoint delivery targets, so events can be routed to different subscribers rather
  than a single configured URL.
- Jittered backoff, to avoid synchronised retry storms when a receiver recovers.
