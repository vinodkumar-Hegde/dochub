# DOCUSEND — Secure PDF Preview and Student Access (local development handoff)

## Scope and source integrity

This increment extends the **existing** V20 Uploads table, S3 read endpoint, and student tile workflow; it does not replace the approved navigation. No new AWS resources are required. Do not push to GitHub without final local verification and owner approval. This is a source update, not a verified deployed release.

## Implemented

1. Admin Uploads table has a **Preview** action for published PDFs and scanned, READY versions. The PDF appears in an in-page modal. Replacement PREVIEW selects the newest scanned READY version; students continue to read the prior PUBLISHED version until explicit publication.
2. `GET /v1/documents/:id/read` checks Cognito principal and profile. Administrators with `SUPER_ADMIN` or `CONTENT_MANAGER` may preview scanned versions. Students must have a published document, a locked programme, mapped subject/plan, and matching, unexpired enrollment for **all four** course/programme/subject/plan dimensions. Other roles cannot use student access by default.
3. The read endpoint generates an expiring (120-second) S3 GET URL with inline PDF rendering, logs `DOCUMENT_READ_AUTHORIZED`, and returns **no private S3 key**. The UI never stores the URL in persistent browser storage. Reloading the preview requests a fresh authorized URL.
4. `GET /v1/student/catalogue` derives programme-first navigation from authenticated STUDENT enrollments and currently locked academic mappings (including programmes with no published PDF). Only subjects in active enrolled/mapped combinations are shown.
5. `GET /v1/student/materials` returns a paged projection of published documents filtered by exact current entitlement, mapping, and a PUBLISHED PDF version. No S3 credentials or object keys in listing responses.
6. AuthGate routes the real STUDENT profile to the existing V20 tile-style student portal with API-backed learning. Old static sample-material PDF pages are not used in this authenticated path. Other, not-yet-connected student modules explicitly say they are not connected rather than display simulated production data.
7. Device-only pinned-document shortcuts are filtered against the currently authorized catalog. The `/read` endpoint rechecks entitlement on every preview request.
8. S3 multipart cancellation runs before the database records are marked deleted. Transient AWS failure keeps the row cancellable; `NoSuchUpload` handles already-cancelled S3 sessions. AWS lifecycle rules remain a fallback for orphaned multipart parts.
9. Add a PostgreSQL index on `DocumentPlan(planId, documentId)` for plan-filtered student material queries.

## Changed API contracts

| Endpoint | Principal | Response |
|---|---|---|
| `GET /v1/student/catalogue` | `STUDENT` | `{programmes:[{id,name,courseId,courseName,subjects:[{id,name}]}]}` |
| `GET /v1/student/materials?cursor=<uuid>&limit=50` | `STUDENT` | `{items:[{id,title,courseId,courseName,programmeId,programmeName,subjectId,subjectName,pageCount}],nextCursor}` |
| `GET /v1/documents/:id/read` | `STUDENT` entitled or authorized admin | `{url,expiresInSeconds:120,versionId,pageCount}` |
| `POST /v1/documents/:id/versions/:versionId/abort` | owning manager or super admin | `{status:"DELETED"}` only after successful S3 abort or confirmed `NoSuchUpload` |

## Apply and verify (Mac)

1. Check current changes to the files listed in this ZIP. No `git reset`, duplicate backup-source files or unrelated application changes. If your project is still without `.git`, establish and inspect local version control before future large changes. Verify `.env`, `.env.local`, AWS credentials, Terraform variables and other secrets are excluded.
2. Extract the ZIP at the project root. This will overwrite only the listed application files; examine any local changes before extraction.
3. Apply the new additive migration and regenerate Prisma client:

   ```sh
   cd ~/Desktop/AI_RESEARCH/dochub/services/api
   npm run db:generate
   npm run db:migrate
   npm run typecheck
   node --import tsx --test src/document-access-policy.test.ts src/documents.test.ts src/documents-policy.test.ts
   npm run build
   cd ../..
   npm run build
   ```

4. Run **one** API instance on port 3011 (`AWS_PROFILE=dochub-terraform AWS_REGION=ap-south-1 npm run dev`) and one frontend on 5190 (`npm run dev -- --host localhost`). Do not run multiple copies or stop other projects. Keep the separate PDF worker running when uploading new documents.
5. As Super Admin, open Uploads and click **Preview** on a PUBLISHED PDF; check the actual pages. Confirm `DOCUMENT_READ_AUTHORIZED` audit record and that `/read` returns an expiring URL. Preview READY before publication; confirm the same document cannot be read by an unentitled student.
6. Check the prior incomplete `UPLOADING` record. Only after confirming it is stale, choose **Cancel upload** and verify it leaves the list. Check the S3 multipart cancellation and `UPLOAD_ABORTED` audit event. Never bulk-delete published records for cleanup.
7. Create an independently authorized Cognito STUDENT account, map its `identitySub` to an enabled DB user and STUDENT profile via the approved provisioning process, and assign a valid `Enrollment` with **existing academic IDs**. *There is no production subscriber-provisioning UI in this increment.* Do not infer student identity from a selected demo name. Do not promote users by email matching. Verify subscribed programme → subject → published PDF and Preview work for this user.
8. Verify an unrelated course, subject, plan and programme, expired enrollment, missing STUDENT role, unpublished document, deleted document and unlocked mapping all deny student reading. Verify that a prior published PDF stays available during a pending replacement. Confirm no presigned S3 URL appears in application logs, browser persistent storage or PDF catalogue payload.
9. Verify browser Escape/close behavior, reader scroll, focus, mobile/tablet layout and visible failure state. Run an end-to-end browser test with a real PDF, not a mocked object.

## Security caveats and remaining work

- **Signed URLs are bearer capabilities:** after issuance, a link can be opened by whoever possesses it until expiration; deletion or revoked enrollment blocks *new* link issuance but does not immediately invalidate existing links. Browser PDF tools can print/save: the embedded viewer is **not DRM**. For stronger revocation, watermarking, printing controls and annotations, adopt a separately approved document proxy or supported secure PDF rendering architecture. No claims of print/download prevention are made.
- Student `Enrollment` records and student profile provisioning exist in PostgreSQL but the approved Subscribers UI is not yet bound to authorized enrollment-management APIs. A positive student authorization test requires a real entitled account and a valid enrollment.
- Student bookmarks are optional per-device shortcuts, not synchronized academic progress or annotations; they never convey authorization.
- A single student may hold multiple enrolments; indexing is added, but plan scale/query plans, revocation latency and load tests are outstanding. The paginated student listing filters any legacy records that do not match locked mappings.
- Current infrastructure uses developer AWS authentication; production least-privilege IAM, SQS worker hosting, observability/alerts, CI/CD gates and recovery remain outstanding.
- Project source root currently shows **not a git repository** on the user's Mac. Establish clean local history and inspect secret exclusions prior to any GitHub delivery.
- No full npm build or real AWS runtime tests were executable in the artifact-generation environment. Mac checks and real student role tests are mandatory before claiming production verification.

## Release status

Focused preview policy tests: 5/5 passed under transpiled Node tests. Changed TS/TSX syntax parsing passed. Database migration, full TypeScript build, browser preview, AWS cancellation and student authorization checks are **pending local verification**. No GitHub push.
