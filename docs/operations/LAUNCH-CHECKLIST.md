# Deployment and launch checklist

Use this checklist for each environment and release. Store environment-specific values and acceptance results in the team's deployment system.

## Configure and deploy

1. Configure the private repository, branch protection and GitHub Actions runner/billing; run both Verify jobs on the release commit.
2. Provision the resources in [AWS setup](AWS-SETUP.md), configure HTTPS and trusted ingress CIDRs, and supply secrets through the deployment secret store.
3. Set `ADMIN_EMAIL` and `ADMIN_NAME` to the intended administrator. Configure the verified SES sender separately.
4. Build immutable images tagged with the commit SHA. Back up the database, apply migrations once, update antivirus signatures and run the admin bootstrap job.
5. Start API, PDF worker, notification worker and web services using [the Docker commands](DEVOPS-HANDOFF.md#first-docker-run).

## Functional checks

- Verify readiness, administrator/student OTP delivery and sign-out; check expiry, revocation and the two-device limit.
- Verify employee View/Manage restrictions and expired-student feature locks.
- Upload and publish representative PDFs; confirm student visibility, protected reading, annotations, mobile/tablet layouts, watermark and download/print permissions.
- Verify custom and publication notifications, audience selection, read counts, retry recovery and notification-worker progress.
- Check analytics filters, totals and pagination against known data.
- Verify unsigned/expired CDN requests and original-object access are denied, and valid signed page access succeeds.

## Load testing and sizing

Target: 80,000 registered students and up to 10,000 active users. Use synthetic staging accounts, representative PDF sizes/page complexity and production-like TLS, private CDN, database and worker configuration.

1. Agree request rates, reading dwell times, document popularity, OTP bursts and numerical latency/error objectives with the application owner.
2. Ramp through 100, 500, 1,000, 2,500, 5,000 and 10,000 active sessions. Hold each stage to steady state and run a sustained soak at the target.
3. Exercise page reads, grant renewals, annotations, search, session access, notifications and publication together. Include cold/warm caches, shared campus IPs, simultaneous logins and subscription expiry.
4. Measure p50/p95/p99 latency, unexpected errors, CPU/memory, database locks/IO/connections, CDN hit ratio/bandwidth, SES throttling, queue age and worker disk usage. Budget database connections across all replicas.
5. Test process restarts, delivery retries, permission revocation and database failover. Confirm no duplicate/missing receipts, unauthorized access or sustained memory growth. Adjust infrastructure and repeat affected checks.

## Operations and release

- Configure alerts for API failures, worker backlog, DLQ, SES failures, database resources and antivirus freshness.
- Schedule auth pruning and antivirus updates. Verify database restore/PITR and S3 retention.
- Record image tags, migration state, configuration references and rollback steps. Keep additive schema and the notification worker available until queued jobs drain during rollback.
- Promote the reviewed release from `dev` to `prod` after completing the environment checks, then repeat health and functional smoke checks.
