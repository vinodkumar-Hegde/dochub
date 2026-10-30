# Capacity fixes and verification

The primary application bottlenecks found on the 80,000-student fixture are fixed: analytics no longer fails from a huge relation query, notification sends no longer hydrate every recipient in the publication transaction, and unchanged student workspaces no longer repeatedly download their catalogues/material lists.

**This is not approval for a production mixed workload of 10,000 active users.** Local changes and measurements below improve the foundations; staging still needs representative PDF traffic, login bursts, TLS/CDN/AWS, resource sizing, failure recovery and a sustained soak.

Raw results: [capacity-fixed-results.json](capacity-fixed-results.json). Historical baseline: [CAPACITY-80000.md](CAPACITY-80000.md).

## What changed

- Analytics uses a parameterized PostgreSQL aggregate query instead of loading all student/session/view/event records into Node. It uses one SQL statement per request, shares eligible audience calculations across equivalent document scopes, and returns at most 50 inactive-student/material detail rows per page. Both tables have pagination controls; summary totals remain global to the selected filters. Actor/time and notification-source indexes support the new access patterns.
- Notification publication persists only the event and durable delivery job in its transaction. A separate worker inserts up to 1,000 recipients per batch, rechecks current eligibility, commits its cursor/counters atomically, and resumes after restart. SKIP LOCKED allows independent workers without duplicate receipts. Custom-send retries preserve the expected audience estimate while delivery is pending. Admin UI distinguishes queued, sending, delivered and retry states; delivery metadata is not exposed to students.
- Database-maintained inbox counters eliminate repeated historical receipt counts. Scoped content revisions cover a user's own subscription/permission changes and subscribed courses. Taxonomy changes invalidate shared context; unrelated course changes do not trigger every student to reload. The revision token also incorporates currently active grants, so scheduled activation/expiry does not require a cron update.
- Student workspaces share one small change request approximately every five seconds with jitter, visibility handling, overlap prevention and retry backoff. Full lists reload when the relevant revision changes or the user returns to the workspace. Today's session data reloads on changes/day rollover; the minute timer otherwise updates only the local clock. The full account check runs approximately every 60–70 seconds while visible. Disabled/revoked account responses clear the UI.
- Session authorization uses one indexed SQL statement for session, current roles and subscription eligibility. It still checks revocation, email, enabled state, idle/absolute expiry and current feature access on every request. There is no long-lived authorization cache.
- PDF navigation discards obsolete queued page downloads after a distant jump and aborts obsolete annotation GETs. Only the existing bounded active image loads may finish. Private CDN configuration and bounded reader/worker processing remain supported; original PDFs remain private.

- HTTPS ingress can explicitly configure trusted proxy CIDRs. Forwarded client IPs are ignored by default; nginx sanitizes the API header. This avoids collapsing all clients into one proxy IP for OTP rate limiting when correctly configured.

## Measured local results

Fixture: 80,000 synthetic students/enrollments/sessions/views/audit events, 100 published material metadata records, one course/programme/subject/plan. No real email or AWS traffic was generated. A disposable local PostgreSQL 16 database was used.

| Check | Result |
|---|---|
| Analytics, first and second material pages | HTTP 200, correct 80,000-student totals/open counts; about 2.5–2.7 seconds; sampled peak Node RSS 125 MiB |
| Inactive analytics, historical period, pages 1 and 2 | HTTP 200, correct 80,000 inactive count, 50 distinct rows/page; about 1.6 seconds/request; sampled peak Node RSS 126 MiB |
| Automatic notification enqueue | 22 ms locally; zero recipients expanded in the enqueue transaction |
| Delivery to all 80,000 recipients | 5.43 seconds over 81 batch passes, including terminal completion; sampled peak Node RSS 157 MiB |
| Two concurrent delivery callers | Exactly 80,000 receipts; 5.71 seconds; no duplicate/lost recipients |
| Five read endpoints, 200 requests each, concurrency 20 | All 1,000 requests succeeded; change-check p95 8 ms and two SQL statements/request |
| Heartbeat-only HTTP load | 60,000 requests over 30 seconds, cycling 10,000 synthetic sessions at a target 2,000 requests/sec; zero failures/drops; p95 36 ms, p99 61 ms |

The heartbeat probe used loopback HTTP with load generator and API in the same Node process; its 355 MiB sampled RSS includes both. It excludes TLS, cloud traffic, images/PDFs, OTP verification and browser work. Other endpoint probes use Fastify injection. Short probes and sampled RSS are not production throughput/memory limits, and independent processes/hardware influence results. The 30-second probe also does not cover the five-minute session-touch cycle.

For 10,000 unchanged visible workspaces, calculated background demand drops from approximately 6,500 requests/second to approximately 2,150: about 2,000 small revision checks plus full-account checks. Dataset payloads are not continually downloaded. Publication bursts, user actions, tabs/devices and admin traffic add load. SQL round-trip reduction does not imply the same reduction in database CPU; the database still verifies access.

## Regression and deployment verification

- 104 API unit tests, 57 PostgreSQL integration tests, 48 frontend unit tests passed (209 total).
- Browser checks passed: automatic publication visibility, no material-list refetch for unchanged versions, account revocation, existing admin controls, phone/iPad layouts, 2,000-page navigation, notes return, resizing and pen colours.
- Frontend production build, API typecheck, Docker frontend/API/test builds passed.
- All 25 migrations applied to a fresh Docker database. The restricted application role successfully created a notification job; the separate worker delivered it; authenticated HTTP change checks reported unread=1; reading the notification changed its inbox revision and unread=0. This smoke check is included in CI, without real email delivery.
- Docker ingress checks passed: a forged forwarding header is ignored by default, an explicitly trusted ingress resolves the supplied client address, and `/0` configuration is rejected. Dependency audits reported no known vulnerabilities; workflow lint passed.
- Retry tests cover cursor preservation, backoff, revoked audience members, duplicate prevention, unread counter idempotence and per-user/course change isolation.

Hosted GitHub CI remains subject to the previously documented account billing/spending-limit blocker. Local results do not substitute for a hosted CI pass.

## Deployment requirements

Apply the four new capacity migrations before starting the new API and worker. Index creation and receipt-counter backfill need an appropriate maintenance window on a large existing database. Start the new notification-worker service; otherwise jobs remain queued. See [DevOps handoff](../operations/DEVOPS-HANDOFF.md) for commands and environment settings.

For rollback, keep the new notification worker running until its pending jobs drain and retain the additive schema. Older application images do not contain the new worker entrypoint. Do not reset delivery cursors or drop queue/counter tables as an application rollback shortcut.

Before production approval, run the mixed-workload staging plan in the baseline assessment: 10,000 active users reading representative PDFs through private CDN, search/session actions, notification/publication bursts, controlled OTP/SES testing, appropriately sized database pools/replicas/workers, monitoring and a long soak. Include shared-IP/NAT login behaviour, session expiry/touches, permission revocation, restart/retry and database failover. The changes do not automatically provision infrastructure or establish SES/CDN quotas.

## Reproduce

Use the disposable database setup in [the baseline reproduction guide](CAPACITY-80000.md#reproduce-the-isolated-local-probes), apply all migrations and run the updated script. It requires the explicit local CAPACITY_DATABASE_URL, a database name beginning dochub_capacity, an empty database for seed mode, and a matching synthetic fixture manifest for subsequent modes. It never falls back to the application DATABASE_URL.

```sh
export CAPACITY_REPORT_DIR=/tmp/dochub-capacity-after
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts seed
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts reads
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts analytics
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts analytics-inactive
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts fanout
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts fanout-concurrent
node --import ./services/api/node_modules/tsx/dist/loader.mjs services/api/scripts/check-capacity.mts heartbeat-load
```

The optional heartbeat settings CAPACITY_DURATION_SECONDS (10–120, default 30) and CAPACITY_HEARTBEAT_RPS (10–5,000, default 2,000) bound local load. Each mode writes JSON to the report directory. Fanout modes intentionally create additional synthetic messages. Do not run these fixtures against production data.
