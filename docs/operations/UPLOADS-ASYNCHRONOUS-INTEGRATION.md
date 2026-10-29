# DOCUSEND — Uploads / asynchronous PDF integration

## Scope / approved UI

This incremental delivery preserves the V20 Super Admin tile launcher, Uploads table, course/programme/subject hierarchy and existing modal conventions. It replaces **only the V20 Super Admin Uploads mock** with real authenticated document APIs and direct private S3 multipart uploads. Academic Mapping, Cognito profiles, Sessions, Subscribers, Employees and Student UI are not redesigned or implicitly completed.

## Actual changed source

- `services/api/src/documents.ts` — upload-policy, paginated list/status, approved mapping checks, multipart signing/completion, cancel, retry, publication, soft delete, replacement and student read-authorizations.
- `services/api/src/documents-policy.ts` + `.test.ts` — domain rules and pure unit tests.
- `services/api/src/worker.ts` — retry transitions, DLQ behavior, heartbeat for long jobs, malware quarantine, published-version preservation.
- `services/api/src/server.ts` — authorize `DELETE` CORS preflights from the approved frontend origin.
- `services/api/prisma/schema.prisma` + `migrations/20261028234000_uploads_list_index/` — additive document listing index; no changes to existing records.
- `src/uploads-client.ts` — typed authenticated API calls and 8 MiB (API-configured) signed multipart uploader with three concurrent parts, retry and progress.
- `src/UploadsWorkspace.tsx`, `src/uploads.css` — approved table and modal pattern with persistent records, search/filter, status, errors and controls.
- `src/AdminWorkspace.tsx` — replaces only Uploads mock view and fake file counts with the integrated workspace.

## Security and business rules

1. Cognito access token and an enabled PostgreSQL user are mandatory for every API.
2. Super Admin / Content Manager can list files. Content Managers may edit their own uploads only; Super Admin may manage all.
3. New PDFs and replacements must reference a **locked** academic programme, its mapped subject, and approved plans for the same course. Revalidated at the API and prior to publishing.
4. User-provided filename is never used in S3 object keys. Browser uploads parts directly using short-lived (15-minute) presigned PUT URLs.
5. Server validates file size and multipart part sequence, and verifies completed S3 object size.
6. Asynchronous worker validates PDF signature and page count, runs mandatory ClamAV scan, rejects encrypted files, quarantines detected malware, retries recoverable failures and audits results.
7. Publication is an explicit authorized mutation allowed only for successfully scanned `READY` versions. Replacement retains prior published copy until newly processed version is published.
8. Student read endpoint continues to require active course/programme/subject/plan enrollment AND an approved locked mapping; the S3 read URL expires after 120 seconds.
9. Delete is **soft deletion**, keeping versioned S3 data for legal retention/audit. Physical purge/retention policy has not yet been implemented; do not claim that deletion erases objects.
10. Retry after exhausted attempts is restricted to Super Admin. The queue's DLQ/visibility timeout remain managed by deployed Terraform.

## Mac deployment (existing single project)

Working root: `~/Desktop/AI_RESEARCH/dochub`. Inspect your local changes and the ZIP listing before overwriting. Never apply the archive to another project.

```bash
cd ~/Desktop/AI_RESEARCH/dochub
unzip -l ~/Downloads/dochub-uploads-integration.zip
unzip -o ~/Downloads/dochub-uploads-integration.zip
cd services/api
npm run db:generate
npm run db:migrate
npm run typecheck
npm test
npm run build
cd ../..
npm run build
```

Only one additive index migration is included. Restart **only** the existing DOCUSEND API service on port 3011 and Vite on port 5190. Do not alter other Docker containers or port 3001.

Use a locked programme, at least one mapped subject and at least one mapped plan. In Uploads, choose these, select a real PDF, start the transfer, and verify that a `QUEUED` document appears. Processing changes to `READY` only when the background worker actually runs and succeeds. The worker must be provisioned or locally run with ClamAV, valid virus definitions, `pdfinfo`, AWS authorization, and access to PostgreSQL. **No worker deployment is included in this update.** Do not try to publish queued PDFs or change statuses manually.

Once worker processing is verified: publish, view with authorized student enrollment, replace, and verify that the older published version remains available until the replacement is explicitly published. Check SQS DLQ on failures and audit rows.

## Verification executed in this packaging environment

- Source inspection against the prior Academic Mapping update: completed.
- TypeScript/TSX syntax parse for 28 project source files: passed.
- Focused upload policy tests: 3 passed (via TypeScript transpile and Node native test runner).
- Full frontend and API TypeScript builds: **not run** (npm registry inaccessible; project dependencies unavailable here).
- Local database migration: **not run** here; must be verified on the user's Mac.
- AWS/S3/SQS real integration, ClamAV/PDF worker, end-to-end student read and browser visual regression: **not run**.
- GitHub push: **not performed**.

## Remaining release risks and next increments

- Deploy workers on isolated AWS compute with least-privilege S3/SQS/KMS/DB IAM, supported antivirus signatures, resource limits, logging, alarms and operational recovery. Existing queue resources alone do not process PDFs.
- Complete student-side programme/subject/material discovery and replace V20 student mock data; profile-based module permissions for Content Manager also need UI integration.
- Implement robust upload resumability across browser restarts and token refresh for transfers exceeding Cognito's session lifetime. In-flight part retries are implemented, but full cross-session resume is not.
- Complete notification on publish, administrative file retention/purge policy, annotation integration, audit access reporting, and backend jobs recovery/reconciliation.
- Run production security checks, full release suite, load/concurrency testing and UI regression against approved V20. Verify migrations before any production push/deploy.
