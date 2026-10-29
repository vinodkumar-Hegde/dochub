# Release gates (not yet passed)

- Verify Git status and final diff; inspect for secrets and duplicate implementations.
- Frontend and API: dependency install, typecheck, lint, builds and appropriate unit/integration tests.
- End-to-end: login, authorized upload, multipart retry, worker failure/retry, entitlement-based reading, revoked access, audit.
- AWS: isolated staging provisioning, IAM least privilege, private S3, KMS, queue DLQ, alarms, backups and rollback.
- Database: reviewed migrations, idempotency, transaction/concurrency and recovery.
- Security: scan dependencies and secrets; validate limits and malicious input handling.
- UI: V20 visual regression, responsive/keyboard/accessibility checks.
- Final signed-off report and explicit GitHub push approval.
