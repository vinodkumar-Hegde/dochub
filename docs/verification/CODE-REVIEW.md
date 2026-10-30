# Code review and release verification

Review scope: current working tree, email OTP/session admission, role/module permissions, student entitlements, session editing, PDF publication/reader, notification attachments, environment configuration, migration/deployment commands and committed-secret exposure. This is a targeted engineering review and regression pass, not a penetration-test certification or a guarantee of zero defects.

## Findings fixed

| Finding | Resolution |
|---|---|
| Pen palette rendered transparent | Narrowed toolbar CSS selector; real-browser assertions verify all five computed colours. |
| PDF page drifted during device resize | Preserve the current page when recomputing virtual page height; browser checks resize phone/tablet repeatedly and assert page identity. |
| Known API dependency advisories | Updated Zod to patched v4; bounded body limits retained; added a tracked deepmerge-ts override for Prisma tooling. Removed unused jose dependency. Audit clean at verification time. |
| Frontend Docker build omitted shared validator | Explicitly include only the shared phone validator in build context. No backend secrets copied into browser image. |
| Non-root migration job could not read copied files | Runtime artifacts copied with node ownership; fresh Docker migration command verified. |
| Test container lacked Poppler | Test target and CI explicitly install required PDF renderer. |
| Proxy would collapse all browser IPs into one rate-limit bucket | Bounded trusted-proxy setting; private API; gateway overwrites forwarded IP. Direct access defaults to no proxy trust. |
| Authenticated mutations relied on cookie/CORS behaviour | Central session authorization now rejects mutations without the exact configured Origin. Regression test covers foreign-origin rejection. |
| Notification files only checked extension/signature | Real ClamAV scan before persistence; malware/scanner failure rejects delivery; temporary files removed. Docker API mounts signatures read-only. |
| Old signatures could still pass scanning | Worker and attachment scans fail closed after three days; daily update command documented. |
| Missing reproducible administrator setup | Explicit idempotent deployment command, configured email/name, refuses promotion of existing non-admin and disabled admin. |
| Machine-specific Terraform backend / obsolete login setup | Backend supplied at init, exact-origin validation, current env templates and primary README, legacy Cognito types removed. |
| Runtime used database owner credentials | Separate non-superuser application role; owner is reserved for the migration job, excluded from runtime container environments. |
| No release verification workflow | CI checks build, unit/integration tests, browser regression, dependency audit and Docker builds on dev/prod PRs. |

## Verified

- Frontend production build and API typecheck.
- 103 API unit tests, 54 PostgreSQL integration tests, 44 frontend unit tests.
- All 21 committed migrations against a new PostgreSQL 16 database; integration suite also passed on that fresh database.
- Actual Docker frontend/API builds and API test target. Fresh Compose database migration, administrator creation and repeat-safe bootstrap, API and web startup/readiness.
- Real browser: palette colours; header navigation/search/account menu; analytics; employee View/Manage controls; watermark save; phone/iPad layouts; 2,000-page reader jump/modes; automatic student publication reflection.
- Real container ClamAV signature update, worker prerequisite check, safe attachment scan and EICAR rejection.
- Dependency audit: no reported vulnerabilities in either npm project at verification time. Gitleaks scan of staged release contents and Git history: no detected leaks.

The separate synthetic large-PDF benchmark is documented in `2026-10-30-reader-and-device-controls.md`. Its storage sink is mocked; it does not establish real cloud upload throughput.

## Deployment gates still owned by DevOps

Configure and test the target environment's IAM roles, SES delivery, bucket/CORS/KMS permissions, queue/DLQ, TLS, database backups/restores, signature-update scheduling, monitoring and real representative PDF upload/publication. API readiness checks database connectivity, not AWS readiness. Browser/integration fixtures mock cloud services and do not send real messages. Run container OS/image scanning in your registry; npm audit does not scan Debian/nginx packages.

Configure GitHub repository branch protection and environment reviewers after the remote repository is selected. The repository workflow does not deploy to production. Keep dev/prod secrets and resources separate. See `../operations/DEVOPS-HANDOFF.md` for commands and release/rollback order.

## GitHub publication

Repository: https://github.com/vinodkumar-Hegde/dochub (private), default branch dev, release branch prod. Hosted verification run https://github.com/vinodkumar-Hegde/dochub/actions/runs/40987335091 was blocked before any steps ran by an account billing/spending-limit error. Local checks above passed; hosted CI is still pending. Branch protection also requires a GitHub plan supporting private-repository protection and could not be enabled on the current plan.

## Subsequent capacity assessment

The [80,000-student / 10,000-active capacity review](CAPACITY-80000.md) found a reproducible admin analytics HTTP 500 at dataset scale. The earlier functional-test pass does not establish capacity readiness. See that report for measured results and release blockers.
