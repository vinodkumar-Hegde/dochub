# DOCUSEND local production implementation handoff

## Scope and limits

This artifact extends the uploaded V20 **UI reference** with a new `services/api` service and Terraform resource definitions. It is **not** a migration into the previous production repository, which was not available locally. The V20 UI continues to contain mock state and role switching; it must not be used as production UI without replacing those flows with this authenticated API and a real identity client.

## Architecture

- API: Fastify / Node.js / TypeScript, PostgreSQL via Prisma, JWT verification against an AWS Cognito issuer and JWKS.
- Data: accounts and profile assignment, per-course/programme/subject/plan enrollment, document grants and versions, audit log and transactional outbox.
- Upload: authorized API creates S3 KMS-encrypted multipart upload; browser requests short-lived per-part URLs; completion checks S3 size, commits a queued job and outbox row transactionally.
- Outbox: API polls committed events and sends them to SQS. Duplicate messages are expected and deduplicated through an atomic worker lease.
- Worker: streams the original S3 object to an isolated temporary file, confirms signature/size, runs ClamAV and `pdfinfo`, records page count, then marks ready. Publishing is a separate authorized action.
- Download: API checks exact entitlement intersection and issues a 2-minute S3 presigned URL. Production should replace this with CloudFront signed cookies plus Origin Access Control for CDN caching and isolation, after integration review.

## Endpoints

- `POST /v1/documents/uploads` — create upload
- `POST /v1/documents/:id/versions/:versionId/parts/:partNumber/sign` — sign one S3 part
- `POST /v1/documents/:id/versions/:versionId/complete` — finish upload and enqueue
- `POST /v1/documents/:id/versions/:versionId/retry` — authorized retry after failure
- `GET /v1/documents/:id` — authorization-scoped status
- `POST /v1/documents/:id/publish` — publish processed version
- `GET /v1/documents/:id/read` — short-lived access to published object
- `GET /health/live` and `/health/ready` — liveness/readiness

## Configuration and IAM

- Copy `services/api/.env.example` into an untracked local secret source; never commit live secrets.
- Database credentials must come from Secrets Manager in deployment.
- **No AWS keys in environment or code**: use instance/task roles or AWS SSO locally.
- API task role: `s3:CreateMultipartUpload` (via `s3:PutObject`), `s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetObject`, `s3:ListMultipartUploadParts`, scoped to bucket objects; SQS SendMessage; KMS encrypt/decrypt/data key scoped to object encryption.
- Worker role: scoped S3 GetObject, SQS ReceiveMessage/DeleteMessage/ChangeMessageVisibility/GetQueueAttributes and KMS decrypt.
- Use distinct task roles, private subnets/VPC endpoints, TLS, WAF where exposed, CloudWatch log retention, alarms on DLQ depth and queue age, and DB credentials rotation.
- Terraform presently provisions only document bucket/KMS/SQS. Cognito, RDS, IAM policies, ECS/Fargate/task definition, ECR, networking, CDN, monitoring, budgets and backups are **not yet implemented**.

## Operational requirements not yet verified

1. Pin dependencies with a generated `package-lock.json` once package install succeeds; until then the Dockerfile `npm ci` cannot succeed.
2. Provision production infrastructure using a reviewed Terraform plan and remote encrypted state.
3. Schedule the outbox dispatcher independently from HTTP API once scaled, with multi-instance claim semantics (`FOR UPDATE SKIP LOCKED` or lease). Current polling in API instances can duplicate SQS messages (safe for worker idempotency, not optimal).
4. Add resumable upload UI, list/search endpoints, authenticated profile selection, CRUD/admin workflows, persistent annotation and reading-progress APIs. Remove or isolate V20 simulations.
5. Add a verified malware definition update mechanism to the worker image. Without updated definitions, scanning cannot be certified production-safe.
6. Add S3 event reconciliation to repair completion crashes, orphan cleanup, object integrity verification and scanner sandbox/size limits.
7. Verify genuine large-file uploads, multipart restart, mobile PDF range rendering, concurrency stress, auth/entitlement bypass, partial-failure retries and recovery.
8. Apply migration in staging before production. Database schema assumes externally governed academic IDs; integrate proper foreign keys with authoritative academic tables.
9. Assess data residency, retention policy, backup/restore RPO/RTO and operational runbooks before release.

## Testing and delivery

Source-level entitlement unit tests exist. Package install timed out in this session. No live AWS resources, database, container, app deployment or end-to-end path was exercised. Do not push or deploy this artifact as-is. Keep V20 design unchanged pending actual integration with the authoritative production codebase.
