# Capacity review: 80,000 registered / 10,000 active

**Decision: the current application is not approved for 10,000 simultaneous active users.** The target is 80,000 registered students with a peak of 10,000 active at once. This review found a reproducible analytics failure and substantial scaling risks. Functional tests and the previous large-PDF benchmark did not establish this capacity.

Baseline reviewed: `f54910d8166c712ab88f4aa0c511522af62dd4fa`. Application code was not changed by this assessment. Evidence: [local probe results](capacity-local-results.json).

## Local tests performed

A separate disposable PostgreSQL 16 database contained 80,000 synthetic students, enrollments, sessions, material views and audit events, 100 published material records, one course/programme/subject/plan, and an 80,000-recipient notification. No real application records were changed. No email or AWS request was sent. Images/PDF binaries were not transferred.

Read probes used actual Fastify routes, cookie session authorization, role checks and PostgreSQL queries. Each endpoint received 200 requests at concurrency 20. Transport was in-process Fastify injection, without HTTP/TLS, browser rendering or cloud latency. The short probes are not throughput limits or a 10,000-user test.

| Operation | Observed result |
|---|---|
| Student material list | 200/200 successful; p95 125 ms |
| Student catalogue | 200/200 successful; p95 24 ms |
| Unread notification count | 200/200 successful; p95 13 ms |
| Current account/session | 200/200 successful; p95 18 ms |
| Admin analytics | HTTP 500, reproduced twice; ORM query exceeded prepared-statement bind limit |
| Automatic notification to 80,000 students | 80,000 receipts committed in 3,154 ms; sampled peak Node RSS 828 MiB |

The analytics error included: `too many bind variables in prepared statement, expected maximum of 32767, received 32769`. The measured analytics attempt reached about 709 MiB sampled Node RSS. RSS excludes PostgreSQL and other processes; sampling is not a guaranteed upper bound. The fanout memory figure is process RSS, not incremental memory per notification. These timings apply only to this synthetic local fixture and machine.

## Findings requiring changes

### P1 — Analytics fails on the 80,000-student fixture

`services/api/src/workspace-controls.ts:62` fetches all matching students with enrollments, sessions and views. Relation loading exceeds the ORM/database bind limit on this fixture. Other queries load all documents/views and events; JavaScript then repeatedly scans these arrays. The inactive-student response is also unpaginated. `AuditEvent` has no actor/time composite index in the current Prisma schema.

Required: database-side aggregate queries, bounded/keyset pagination for detail tables, appropriate actor/time indexes after EXPLAIN analysis, and precomputed/async aggregates where needed. Verify all course/programme/plan/status/date filters and counts against known fixtures. Raising process memory or adding API replicas does not fix the bind-parameter failure.

### P1 — Background polling creates a high request floor

`src/StudentDocumentsWorkspace.tsx:27,76,95` requests unread counts every five seconds and fetches both catalogue and material list every five seconds while visible. `src/AuthGate.tsx:25` re-fetches the full account every thirty seconds. Today's sessions are checked every minute. The unread/account/session timers do not consistently stop in hidden tabs.

For 10,000 visible, signed-in student workspaces, before PDF reading, search or user actions:

| Poll | Requests/second (steady average) |
|---|---:|
| Catalogue every 5 seconds | 2,000 |
| First material page every 5 seconds | 2,000 |
| Unread count every 5 seconds | 2,000 |
| Account every 30 seconds | about 333 |
| First today-session page every 60 seconds | about 167 |
| **Minimum total** | **about 6,500** |

Multiple loaded material pages, additional session pages, notification inbox polling, multiple tabs/devices and synchronized timers increase demand. These are calculated averages, not measured live traffic. The local route probes issued roughly 5–15 SQL queries per read, depending on endpoint; database demand is substantially higher than HTTP request count.

Required: authenticated change events or a cheap revision/delta endpoint, event-triggered refetch, visibility/idle handling, jitter and backoff, and bounded overlap. Preserve immediate permission revocation and subscription expiry; do not introduce long-lived entitlement caches as a shortcut. Keep the existing quick-publication behaviour through events rather than repeatedly downloading unchanged datasets.

### P1 — Audience fanout is synchronous and memory-heavy

`services/api/src/notification-delivery.ts:6,27` loads every eligible enrollment and builds nested recipient objects in the publication transaction. The custom-send route has the same broad pattern. The probe succeeded, but used about 828 MiB process RSS for a single 80,000-recipient publication. Concurrent publications and transaction contention were not tested. Automatic publication uses the default interactive transaction timeout; another machine or competing load can make this path slower.

Required: a durable notification-delivery job with bounded batches, idempotent recipient insertion and delivery progress. Keep publication/event creation atomic, while moving large fanout out of that transaction. Ensure notification visibility, counts and retries remain correct. Do not infer a linear memory budget from this single measurement.

### P1 — Large-scale PDF delivery needs CDN validation

The virtual reader and bounded worker are useful foundations. However, without optional CloudFront configuration, every preview page goes through API authorization and an S3 stream (`services/api/src/documents.ts:599`). Notes/progress also use API requests. The earlier 1 GiB synthetic PDF test measured preparation with a mocked storage sink, not bandwidth or 10,000 readers.

Required: configure and load-test private CDN delivery, signed-grant renewal/revocation behaviour, page bandwidth and cache effectiveness. Include page/annotation requests and representative scanned PDFs in the workload. Keep original PDFs private and enforce watermarks/permissions.

### P2 — Infrastructure and login bursts remain unvalidated

Compose runs one API, one worker and one local database by default. There is no measured production sizing, autoscaling policy or aggregate connection-pool budget. Multiple API replicas also dispatch the same outbox; delivery is at-least-once, so shared claiming/dispatch coordination and backlog behaviour need testing even though worker leases provide deduplication.

OTP verification is CPU/memory-intensive scrypt work and SES has account-specific quotas. Per-IP request limits can affect many legitimate users behind one campus/carrier NAT. Benchmark bursts and tune limits without removing per-account/shared abuse protections. The read probes do not test OTP delivery, admission races at large scale, background jobs or database failover.

## Required staging acceptance test

1. Apply the changes above and rerun the 80,000-record regression, including correct analytics counts and complete notification delivery.
2. Deploy production-like managed PostgreSQL, appropriately budgeted API pools/replicas, separately scalable workers, private CDN, queue/DLQ, TLS and monitoring. Size using measurements rather than a fixed instance-count promise.
3. Use a controlled staging load generator with synthetic accounts. Ramp through 100, 500, 1,000, 2,500, 5,000 and 10,000 active sessions; hold each stage long enough to reach steady state, then run a sustained soak at the target. Define reading rates and session publication bursts as part of the workload; active users are not the same as requests/second.
4. Proposed read SLOs for team approval: p95 under 500 ms, p99 under 1.5 seconds, and fewer than 0.1% unexpected failed requests. Separately agree publication latency and notification-delivery SLOs. Expected denied/expired requests are security cases, not application failures.
5. Monitor event-loop delay, process/container memory, CPU, database plans/IO/locks/connections, SES throttling, queue age, CDN hit ratio and bandwidth. Verify no memory growth, missing/duplicate notifications, permission leaks or page-read corruption during soak/recovery.

Hosted GitHub CI is still blocked by the previously documented account billing restriction. Even after it runs, the ordinary workflow does not constitute this staging capacity test.

## Reproduce the isolated local probes

Requires Node 22, installed API dependencies and Docker. Commands are run from repository root. The explicit variable and database-name guard prevent fallback to the application's DATABASE_URL. The script's seed mode refuses a non-empty User table. Synthetic cookie sessions are created only in this dedicated local test database; this is not a login bypass in the application.

```sh
docker run -d --name dochub-capacity-postgres \
  -e POSTGRES_PASSWORD=capacity-local-only \
  -e POSTGRES_DB=dochub_capacity \
  -p 127.0.0.1:55439:5432 postgres:16-bookworm
# Wait until: docker exec dochub-capacity-postgres pg_isready -U postgres
export CAPACITY_DATABASE_URL='postgresql://postgres:capacity-local-only@localhost:55439/dochub_capacity?schema=public'
DATABASE_URL="$CAPACITY_DATABASE_URL" npm run db:migrate --prefix services/api
export CAPACITY_REPORT_DIR=/tmp/dochub-capacity-report
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts seed
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts reads
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts fanout
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts analytics
# analytics currently exits non-zero because the probe reproduces HTTP 500.
# Remove only this disposable fixture after inspection:
docker rm -f dochub-capacity-postgres
```

Results are JSON under CAPACITY_REPORT_DIR (otherwise a directory in the OS temporary directory). Repeated fanout probes create additional synthetic notifications. Do not point load generators at a production environment or real student accounts.
