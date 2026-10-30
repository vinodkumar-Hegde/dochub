# DocHub DevOps handoff

## Components and ownership

| Service | Entrypoint | Purpose |
|---|---|---|
| web | root Dockerfile / nginx:8080 | Static UI and same-origin `/api` gateway |
| api | `node dist/server.js` | OTP, users, permissions, uploads, notifications, analytics |
| worker | `node dist/worker.js` | SQS, malware scan, PDF validation and protected page rendering |
| db | PostgreSQL 16 | Application state and durable outbox |
| migrate | `npx prisma migrate deploy` | Explicit release migration job |
| admin | `node dist/bootstrap-admin.js` | Explicit administrator bootstrap |
| av-update | `freshclam` | Download/update malware signatures |

Docker Compose is a single-host deployment/reference setup. Production teams may replace PostgreSQL with managed PostgreSQL and run web/API/worker separately in their orchestrator. Keep the same commands, env settings and release order. Do not run migrations automatically in every API replica.

## Required infrastructure (configure manually)

1. Provision separate dev/prod databases, private S3 buckets, SQS queues with dead-letter queues, and workload IAM roles. Enable S3 versioning, Block Public Access and encryption. Restrict bucket CORS to your application origin: PUT, Content-Type, exposed ETag. Original PDFs must never be public. Configure lifecycle cleanup of abandoned multipart uploads.
2. Configure SES in the selected region, verify `SES_FROM_EMAIL` or its domain, enable DKIM/SPF/DMARC, and request production sending access. In the SES sandbox, recipients must also be verified. The administrator email is a recipient, not necessarily the SES sender.
3. Grant only required S3 bucket/object/multipart permissions, SQS send/receive/delete/change-visibility, SES SendEmail, and applicable KMS permissions. API and worker should use separate least-privilege roles. Queue visibility starts at 30 minutes and is renewed by the worker; set DLQ/redrive and alarm on failures/age.
4. Terminate HTTPS at your managed load balancer or host reverse proxy. Forward to the web gateway on loopback port 8080. Use the exact public HTTPS origin in `CORS_ORIGIN`. Keep API and database ports private. Never disable certificate verification or copy local AWS CLI/SSO profiles into images. SDKs use the normal AWS credential chain; attach instance/task roles in production.
5. Back up PostgreSQL with tested restores/PITR and retain S3 versions. Configure monitoring for API errors, disk/memory, failed/quarantined PDFs, stale processing, SQS queue age/DLQ, SES failures, DB health and ClamAV signature freshness.

No local SSL bypass, SSH tunnel, AWS session, account ID, administrator address or private key is required by the code. Optional CloudFront uses private signed page grants; configure all three CDN variables and mount the signing file read-only. Terraform under `infra/` is optional reference infrastructure; review its legacy Cognito resources before applying. It is not required for current email OTP authentication.

## First Docker run

Install Docker Engine/Desktop with Compose v2. Commands below run from the repository root. Docker installs npm packages, Poppler, ClamAV and CA certificates.

```sh
cp deploy/.env.example deploy/.env
# Edit deploy/.env: different random URL-safe owner/app DB passwords, AWS values, SES sender,
# ADMIN_EMAIL and ADMIN_NAME. Never use example credentials in deployment.
docker compose --env-file deploy/.env config --quiet
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d db
docker compose --env-file deploy/.env run --rm migrate
docker compose --env-file deploy/.env run --rm av-update
docker compose --env-file deploy/.env run --rm admin
docker compose --env-file deploy/.env up -d api worker web
docker compose --env-file deploy/.env ps
curl --fail http://localhost:8080/health/web
curl --fail http://localhost:8080/api/health/ready
```

The example intentionally supports a local HTTP smoke test at `http://localhost:8080`. For any real deployment set `NODE_ENV=production`, `CORS_ORIGIN=https://your-domain`, and configure HTTPS before use. Production API refuses insecure login configuration. Open that origin and sign in with `ADMIN_EMAIL`; SES delivers the OTP. There are no passwords or fallback OTP codes.

`ADMIN_EMAIL` is used only by the admin job, not automatically on startup. Repeating the command is safe for an existing enabled administrator. It refuses to promote an existing student/employee or enable a disabled administrator. Changing the env value does not rename/delete an existing admin; it creates a separate administrator. Manage access deliberately and audit removals.

Workload IAM roles must be reachable from the containers. For a local-only credential test, inject short-lived `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` using an untracked Compose override/secret store; do not write them to the repository. For optional CDN signing, also add a read-only file/secret mount for API. The baseline Compose does not mount developer AWS directories or private keys.

On a fresh volume, `deploy/init-db.sh` creates a runtime role without superuser, database creation or role administration privileges. Migrations use the owner; API/worker/admin use the runtime role. Compose passes only selected runtime variables into these containers, excluding the migration owner password. For an existing database, have the DBA create the runtime role and grant CRUD on existing tables/sequence usage plus owner default privileges before switching runtime credentials. Init scripts do not rerun on existing volumes. Changing env passwords does not rotate existing PostgreSQL roles; perform a coordinated database password rotation.

The named `postgres-data` volume persists data. Never use `docker compose down -v` against an environment you need. Workers need temporary disk for the input PDF and bounded render batches; size storage for concurrent uploads above `MAX_PDF_BYTES`. Start with at least 4 GiB worker memory and measure representative image-heavy PDFs before setting resource limits or increasing concurrency. The baseline is not a managed HA database deployment.

## Configuration

| Variable | Required / meaning |
|---|---|
| `DATABASE_URL` | API/worker PostgreSQL URL; Compose derives it from POSTGRES variables. External DB: override API environment with a TLS URL appropriate for the provider. |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Compose database owner used by the migration job; password must be random, URL-safe and secret. |
| `APP_DB_USER`, `APP_DB_PASSWORD` | Separate non-superuser runtime role; use a different random URL-safe password. |
| `AWS_REGION`, `S3_BUCKET`, `SQS_QUEUE_URL` | Explicit deployment resources; no account-specific default. |
| `CORS_ORIGIN` | Exact browser origin, HTTPS in production; no wildcard. |
| `NODE_ENV` | `production` for real deployments. |
| `SES_FROM_EMAIL` | Verified SES sender; login delivery fails closed if unavailable. |
| `ADMIN_EMAIL`, `ADMIN_NAME` | Admin bootstrap job only. |
| `PORT` | API listener, 3001 in Compose; not publicly exposed. |
| `TRUST_PROXY_HOPS` | 0 direct API, 1 behind the provided gateway which overwrites X-Forwarded-For. Never expose a trusting API directly. Compose sets 1. |
| `MAX_PDF_BYTES` | Default 10 GiB; worker storage and infrastructure must match. |
| `PDF_RENDER_CONCURRENCY`, `PDF_UPLOAD_CONCURRENCY` | Each 1–4, default 2. Bound worker CPU/memory/network. |
| `PDF_VERIFICATION_POLICY` | Default clamav-poppler-v1; bump deliberately to invalidate reuse of old verification. |
| `PREVIEW_CDN_ORIGIN`, `PREVIEW_CDN_KEY_PAIR_ID`, `PREVIEW_CDN_PRIVATE_KEY_FILE` | Optional all-or-none CDN configuration; file mounted, never baked into image. |
| `PREVIEW_CDN_TTL_SECONDS` | 15–120 seconds; default 60. |
| `PDF_WORKER_IMAGE` | Optional image identifier for verification audit metadata. |
| `VITE_API_ORIGIN` | Public frontend build setting; Docker defaults to `/api`. Never place secrets in VITE variables. |
| `IMAGE_TAG`, `WEB_PORT` | Compose image tag and loopback port; defaults local / 8080. Always supply the CLI env file. |

Node SDK credential-provider variables are supported by AWS, not custom credential code. Keep env files mode 600 and supply secrets from the orchestrator/secret manager. Nginx allows up to 15 MiB JSON for notification attachments; API limits ordinary JSON to 256 KiB and attachments to three files / 5 MiB each / 10 MiB total. PDF binaries upload directly to S3 as multipart parts.

## Endpoints and checks

Public gateway prefixes the API with `/api`. API internal paths:

| Endpoint | Purpose |
|---|---|
| GET `/health/live`, `/health/ready` | Process / DB readiness; not AWS or worker health. |
| POST `/auth/otp/request`, `/auth/otp/verify`, `/auth/logout` | JSON with exact Origin header; OTP authentication. |
| GET `/auth/session`, `/auth/me` | Current session and account. |
| `/v1/academic/*` | Academic records/mapping/context. |
| `/v1/documents/*`, `/v1/folders/*` | Upload lifecycle, permissions, previews and study annotations. |
| `/v1/student/catalogue`, `/v1/student/materials`, `/v1/student/sessions` | Entitled student content. |
| `/v1/admin/notifications`, `/v1/student/notifications` | Custom/automatic notifications and views. |
| `/v1/admin/analytics`, `/v1/admin/employees`, `/v1/admin/watermark` | Administrative controls. |
| `/v1/admin/subscribers/*`, `/v1/admin/sessions/*`, `/v1/search` | Users, live sessions and global search. |

See route registrations in `services/api/src/server.ts` and corresponding modules for exact verbs/payloads. Protected routes require HttpOnly session cookies and role/module/entitlement checks. Two active devices allowed; third rejected. Session idle timeout is 30 minutes, absolute lifetime 12 hours. OTP expires in ten minutes with attempt/rate limits.

```sh
docker compose --env-file deploy/.env logs --tail=100 api worker
docker compose --env-file deploy/.env run --rm migrate npx prisma migrate status
docker compose --env-file deploy/.env exec api node dist/prune-auth.js
docker compose --env-file deploy/.env run --rm av-update
```

Schedule auth pruning daily and signature updates at least daily; alert if either fails. Notification attachments also require current ClamAV signatures. Scans fail closed if signatures are over three days old. The API and worker mount the same signature volume read-only. Malware/scanner errors reject attachments; an unavailable scanner prevents the worker from consuming jobs. Never bypass scanning to restore service.

## Tests and dependencies

```sh
npm ci
npm ci --prefix services/api
npm run build
npm run test:unit
# With Vite running and VITE_API_ORIGIN=http://localhost:3001:
npx playwright install chromium
npm run test:ui
npm run typecheck --prefix services/api
npm test --prefix services/api
node --import ./services/api/node_modules/tsx/dist/loader.mjs --test tests/unit/*.test.ts
npm audit --audit-level=moderate
npm audit --prefix services/api --audit-level=moderate
docker build --target test -t dochub-api-tests services/api
docker build -t dochub-web:test .
```

Integration tests require a **dedicated local test database**. Set `DATABASE_URL` to that local test database, provide the non-secret AWS/config placeholders from `.github/workflows/ci.yml`, then run from `services/api`:

```sh
npm run db:generate
npm run db:migrate
node --import tsx --test tests/*.integration.ts
```

Browser tests mock API responses and do not send real emails or upload files. `DOCHUB_BASE_URL`, `DOCHUB_API_ORIGIN`, and optional `DOCHUB_BROWSER` select the test server/API/browser executable. Tests refuse non-local database hosts and mock AWS/OTP delivery. CI provisions a fresh PostgreSQL service and runs these automatically. Never point tests at production. To add a frontend dependency use `npm install PACKAGE`; for API use `npm install --prefix services/api PACKAGE` (`-D` for development tools). Commit package.json and lockfile together, rerun checks/builds, and rebuild images. Do not install packages manually inside running containers. The Prisma-tooling deepmerge-ts override is tracked in package.json; remove only after the upstream dependency is fixed and audit/tests pass.

## Release, migration and rollback

Use `feature/*` → reviewed PR into `dev` → staging verification → release PR into `prod`. Protect dev/prod in GitHub: PR required, Verify workflow required, no force pushes/deletion, CODEOWNERS review appropriate for your team. Add environment reviewers/secret isolation and dependency/image scanning in your organization. CI verifies code; it does not automatically deploy or hold production secrets.

Build and tag immutable images by commit SHA in your registry. Back up DB; run the migration job once; deploy worker/API/web with the same release; check readiness, OTP delivery, permissions, a real PDF upload/publication, student display and notification views. Fresh installations use committed SQL migrations; existing installs use `prisma migrate deploy`. Never use `db push`, `migrate reset` or development seeds in production. If an existing database was created without migration history, baseline it only after comparing its schema and reviewing a backup; do not mark migrations applied blindly.

Rollback application images to the last compatible SHA. Prisma deploy does not reverse schema/data migrations. Use forward fixes or a reviewed restore/rollback plan. Prefer additive schema changes and keep old application compatibility until release verification completes. Document manual AWS changes separately. The synthetic PDF benchmark is not a substitute for end-to-end testing with real S3/SQS/SES and representative PDFs in staging.

## Local Docker troubleshooting

If Docker reports exhausted default address pools, select an unused subnet in a local Compose network override or adjust Docker address pools. Do not delete networks belonging to other projects. This is host configuration, not an application dependency.

## Repository

Private repository: https://github.com/vinodkumar-Hegde/dochub. Default branch: `dev`; release branch: `prod`. The initial branch-protection API requests were rejected because this account requires GitHub Pro for private-repository protection. Upgrade the account or move to an organization plan that supports it, then enable the PR/check/review policies described above. Keep the repository private. The Verify workflow also supports manual runs from the Actions tab.
