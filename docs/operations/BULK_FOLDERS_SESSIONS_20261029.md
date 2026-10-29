# DOCUSEND — Subscribers Bulk Import, Subject Folders, Live Sessions

Status: source implementation candidate; local Mac and AWS runtime gates not yet passed. Preserve approved V20 tile navigation and existing student-login pause.

## Changes

### 1. Bulk subscriber CSV import
- Admin-only: `POST /v1/admin/subscribers/import`; max 200 rows/request.
- CSV must contain `Student name,Email,Phone number,Course` with support for quoted values. Download template within Subscribers.
- Admin selects course, locked programme, mapped subjects, and one or more plans. CSV course values must match selected course name or code. Separate CSVs per course.
- Atomic serializable transaction: validates the entire file, rejects duplicate emails and collisions with non-student profiles, creates pending student users, assigns all exact grants, writes per-student audit events. No Cognito/SES/OTP required. Existing subscriptions are preserved.
- `User.phone` is an optional field; the UI also accepts it on single-student creation.

### 2. Subject folders and file organization
- Authenticated `GET/POST /v1/admin/folders`; `PATCH /v1/admin/folders/:id`; `POST /v1/admin/folders/:id/copy`.
- Authenticated `PATCH /v1/admin/documents/:id/organize`; `POST /v1/admin/documents/:id/copy`.
- Folder scope is one locked programme and subject (single-level subject folders; no nested hierarchy). Folder names unique within each programme+subject. Revision checks and audit events are mandatory.
- Admin can hide/unhide and lock/unlock folders/files, move files into a folder or subject root, copy/paste published PDFs, copy a folder and up to 20 of its published files.
- Copy/paste is intentionally restricted to the **same course/programme/subject** to avoid unintended plan-entitlement escalation. S3 server-side copy creates new objects and new database document versions, not shared references. S3 CopyObject requires read/decrypt on source, write/encrypt on target, and active AWS SSO credentials locally.
- Existing student material catalogue, PDF detail, and time-limited signed URL responses deny hidden/locked documents and their parent folders. Previously issued signed URLs remain usable until they expire (currently 120 seconds), as documented in the earlier content-security handoff.
- Student subject navigation includes visible folders; underlying PDF entitlements still apply.

### 3. Real session management
- `GET /v1/admin/sessions/summary`, `GET/POST /v1/admin/sessions`, `PUT /v1/admin/sessions/:id`, `POST /v1/admin/sessions/:id/publication`.
- Form: course, approved programme, mapped subject, faculty, topic, start/end date and time (IST), platform, YouTube URL when applicable, remarks, status, multiple selected plan grants.
- Explicit publish/unpublish; updating a session **automatically unpublishes** it until the administrator confirms the revised plan targets. Updates have revision checks; non-Super Admin managers cannot edit other managers' sessions; changes and publication are audited.
- `GET /v1/student/sessions` supports programme and Today/Upcoming/Completed/All. API checks verified student role, active exact subscription and current locked academic mapping; unpublished sessions never leak. YouTube links are included only with authorized published records.
- Student login remains **paused** by approved decision. The student session UI and API are ready but are not accessible anonymously. Do not bypass authentication for testing.
- Session attendance/response submissions and app notification delivery are outside this update and remain required follow-on work if those previously approved workflows must be completed.

## Additive migration
- `services/api/prisma/migrations/20261029090000_bulk_folders_sessions/migration.sql`: `User.phone`, `Document.folderId/hidden/locked/revision`, `DocumentFolder`, `LiveSession`, `LiveSessionPlan`, enums and indexes.
- This migration intentionally retains all existing PDF records and subscription data. Back up production data before migrations; confirm no local manual schema divergence.

## Source verification performed here
- TypeScript parser: all 17 modified `.ts`/`.tsx` files parsed without syntax errors.
- 10 policy tests passed: CSV, folder visibility, locked mapping, YouTube link, exact student subscription, expiry and IST date boundary.
- ZIP integrity verified.
- **Not verified in this environment:** npm-powered full frontend/API typechecking or builds, PostgreSQL migration, live S3 CopyObject, browser interactions and real student authorization. Network access to npm registry is unavailable. These must be run on the Mac.

## Mac verification (focused and final-candidate gates)

Before overwriting local source, compare the ZIP file list to any independent local changes. This folder previously reported **not a Git repository**; preserve your working copy and establish local source history before controlled delivery. Do not push to GitHub until the project owner approves.

```bash
cd ~/Desktop/AI_RESEARCH/dochub
unzip -l ~/Downloads/dochub-bulk-folders-sessions.zip
unzip -o ~/Downloads/dochub-bulk-folders-sessions.zip

cd services/api
npm run db:generate
npm run db:migrate
npm run typecheck
node --import tsx --test src/sessions-policy.test.ts src/folders-policy.test.ts
npm run build

cd ../..
node --experimental-strip-types --test src/subscriber-csv.test.ts
npm run build
```

Restart **one** DOCUSEND API instance on port 3011 and **one** frontend on 5190. Keep the existing AWS profile in the API terminal (`AWS_PROFILE=dochub-terraform`, `AWS_REGION=ap-south-1`) when testing file copying.

### Browser acceptance checks
1. Subscribers > Bulk upload > download CSV template > import two different emails under an approved course/programme with two plans. Verify records + phone + grants, reject duplicate email and invalid course. Student login remains paused.
2. Uploads > select course, programme, subject > New folder > upload a PDF into it > hide/lock/unlock > copy file into another folder > preview new copy, confirm original unchanged. Validate student document endpoints deny hidden and locked content.
3. Sessions > create draft with topic, faculty, dates, programme and subject > select multiple plans > save > publish. Edit YouTube URL and verify the session becomes unpublished until republished. Verify unauthorized account cannot retrieve a plan's sessions.
4. Before GitHub approval: complete strict frontend/backend types, lint if configured, final builds, change-focused tests, role/entitlement regression, security checks, and one full regression suite against the final candidate. Verify S3 copy permissions and PostgreSQL migration rollback plan.

## Risks
- S3 CopyObject may require further least-privilege permission grants (S3/KMS). Do not widen IAM speculatively.
- A folder copy is limited to 20 published files and is deliberately same-subject only.
- Admin session summaries and student lists are bounded. Very large scale requires cursor paging and indexed read models.
- Student session end-to-end tests await safe re-enablement of student authentication.
- Pending subscribers have no login access and cannot open protected PDFs.
- Backend email/OTP provisioning remains paused; this update does not silently reactivate it.
- No Github push or production deployment has been attempted.
