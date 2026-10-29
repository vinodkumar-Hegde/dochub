# DOCUSEND — Local PDF worker readiness and verification

## Scope and status

This change **does not deploy an AWS worker** or claim that the PDF upload, S3 object, queue delivery, antivirus definitions, or publication is verified. It hardens the existing authoritative PDF worker to **fail before polling SQS** if Poppler, ClamAV/signatures, PostgreSQL, or the AWS SDK credential chain is unavailable. The approved V20 UI, database schema, bucket, queue, Cognito, and document API remain unchanged.

## Code changes

- `services/api/src/worker.ts`: mandatory startup checks before receiving SQS messages.
- `services/api/src/worker-prerequisites.ts`: bounded Poppler verification and harmless ClamAV scan. A version check alone is not enough to prove definitions are usable.
- `services/api/src/worker-prerequisites.test.ts`: three isolated startup-policy tests with injected command runner, requiring no actual ClamAV installation during unit tests.
- `scripts/run-pdf-worker-local.sh`: explicit local config loading with Node 22, missing-environment checks, and no embedded AWS keys.

## Prerequisites on the Mac

1. Preserve and verify the API service on port **3011** and frontend on **5190**; do not start duplicate API instances.
2. Confirm at least one document version is actually **QUEUED** after a complete S3 multipart upload. A 201 response to upload initialization alone is insufficient. The PDF worker must not be used to compensate for an unfinished upload.
3. Confirm PostgreSQL is running and `services/api/.env` contains the correct `DATABASE_URL`, `AWS_REGION`, `S3_BUCKET`, and `SQS_QUEUE_URL`. Never share the `.env` file.
4. Install maintained Poppler (`pdfinfo`) and ClamAV (`clamscan`) utilities on the Mac, then initialize/update ClamAV signatures using the installed version's documented configuration. The worker now refuses to poll SQS until a harmless test file scans successfully. No virus database or private configuration is bundled.
5. Refresh your existing AWS CLI login via `aws login` if expired; validate your chosen profile using `aws sts get-caller-identity --profile dochub-terraform`. Do not create long-lived IAM keys.

## Verification sequence

From project root, use one terminal for the already-running API (this dispatches outbox messages), another for frontend, and a **third** for the worker:

```bash
cd ~/Desktop/AI_RESEARCH/dochub
export AWS_PROFILE=dochub-terraform
export AWS_REGION=ap-south-1
bash scripts/run-pdf-worker-local.sh
```

On a clean start, the worker emits `PDF worker prerequisites, database and AWS SDK credentials verified`, then waits for SQS work. If signature loading or AWS resolution fails, it exits **without consuming queued jobs**.

To validate the update in `services/api` without repeating unrelated builds:

```bash
cd ~/Desktop/AI_RESEARCH/dochub/services/api
npm run typecheck
node --import tsx --test src/worker-prerequisites.test.ts
npm run build
```

When a queued PDF is processed, verify through the admin Uploads list that its state changes `QUEUED` → `PROCESSING` → `READY`, and that pageCount is populated. Only then publish as a permitted administrator. Check SQS DLQ, audit events, and the actual student's approved plan access, including denied access for an unenrolled student.

## Security and operational notes

- Worker receives object bytes from **private S3**, scans before it can set `READY`, and never auto-publishes. S3 access and encryption remain governed by AWS IAM and KMS.
- The ClamAV test uses a harmless temporary text file, file mode `0600`, and removes it even on failure.
- A working AWS CLI alone does not prove Node AWS SDK credentials; the worker checks the same SDK provider it uses for S3.
- The existing worker uses SQS visibility leases, database update guards, and DLQ retries; do not run manually against production or use broad admin credentials for deployed compute. IAM role separation and monitoring are still required.
- This update is a **local preflight**, not AWS container deployment, capacity planning, disk quotas, dashboard monitoring, release approval or end-to-end acceptance.
- Your project path previously returned `not a git repository`; establish local tracked history before additional major changes. Do not push until local verification and owner approval.
