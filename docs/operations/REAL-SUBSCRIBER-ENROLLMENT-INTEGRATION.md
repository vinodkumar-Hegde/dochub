# DOCUSEND — Verified subscribers and enrollment management

**Scope:** additive, local-first increment built upon the Secure PDF Preview & Student Access source update. No GitHub push and no changes to the approved V20 navigation or Uploads/PDF viewer layout.

## Why this increment exists

The STUDENT catalogue and PDF read endpoint require real `Enrollment` database records. Before this increment, V20 Subscribers edited React seed records only, so no on-screen action could make a real student entitled to a published document. This implementation replaces that mock subscriber table with a server-backed view and explicit Cognito identity linking and enrollment management.

## API and business contract

Every route requires a valid Cognito access token and the `SUPER_ADMIN` role. The browser cannot specify a role or student identity for the authenticated caller. `AdminGetUser` verifies that the named existing Cognito user is **enabled**, **CONFIRMED**, and has a verified email; only then can an internal `User` with `STUDENT` profile be linked. This action is idempotent for the same Cognito `sub`. It does **not** create a Cognito login or send an invitation. Backend AWS identity must have permission `cognito-idp:AdminGetUser` for **only the configured user pool** in production.

| API | Description |
| --- | --- |
| `GET /v1/admin/subscribers?limit=25&cursor=<uuid>&q=&courseId=&planId=` | Paginated, server-side filtered subscriber list; verified identity labels and exact enrollments |
| `GET /v1/admin/subscribers/summary` | Real subscriber totals, active subscriber count, and unique active subscribers per course |
| `POST /v1/admin/subscribers/link` `{username}` | Resolve existing Cognito identity, link `STUDENT` role, audit |
| `PUT /v1/admin/subscribers/:id/enrollments` `{revision,grants:[...]}` | Transactionally replace selected user's exact enrollment grants, audit, optimistic revision check |
| `POST /v1/admin/subscribers/bulk-assign` `{userIds,grants:[...]}` | Transactionally add missing, valid grants to selected active STUDENT accounts; audit each target |

Each grant is `{courseId,programmeId,subjectId,planId,validUntil}` (ISO 8601 string or null). All four academic IDs must match an approved, locked programme mapping; plan must belong to its course and programme, subject to programme. Duplicate and expired grants are rejected. `PUT` is an explicit replacement (including revocation by submitting zero grants); the editor preserves grants for other programmes. Bulk operation adds missing grants and **does not change expiry of already-existing grants**; for expiry changes use individual edit. 2,500 grant write cap per bulk request. Update is atomic; serializable transaction conflicts return 409. An audit entry records grants changed and the responsible authenticated administrator. PII labels are never logged in audit event details.

**Identity metadata:** `User.email` and `User.displayName` are populated from verified Cognito attributes, not free-form browser data. This increment adds a database revision and indexes. Existing users and documents are preserved. If an existing Cognito user's email changes, re-linking refreshes the local display label; access remains tied to stable Cognito `sub`.

## Apply and verify on Mac

**Prerequisite:** the immediately preceding secure PDF Preview/Student Access update is installed. Before overwriting files, inspect `unzip -l` and any local edits. The project reportedly lacks Git metadata; establish controlled local history with correct secret ignores before future major development. Never push without explicit project-owner approval.

1. Extract the focused ZIP from the project root. It contains only enumerated changed files; no secrets, AWS keys, sample students or duplicate source modules.
2. Install the one additional backend dependency: in `services/api`, run `npm install` (the package already declares `@aws-sdk/client-cognito-identity-provider`). Do not hand-edit local credentials or add static keys.
3. Run `npm run db:generate && npm run db:migrate && npm run typecheck && npm run build` in `services/api`. Run its focused tests: `node --import tsx --test src/subscriber-policy.test.ts src/document-access-policy.test.ts`. Run `npm run build` in root. Do not repeat the full suite for this focused update.
4. Start exactly one backend (`3011`) with `AWS_PROFILE=dochub-terraform AWS_REGION=ap-south-1`, and one frontend (`5190`). Keep the PDF worker running only if processing uploads.
5. Create/confirm **one actual test student identity** in the existing Cognito pool through an approved administrator workflow. Verify its email. Do not reuse the Super Admin login or enter passwords in chat.
6. In DOCUSEND **Subscribers**, choose **Link subscriber**, enter the actual Cognito username, and verify that the account appears as `No active plan`. Choose **Edit access**, select approved NEET PG → MIQ, Anatomy and Clinical core; save. Reload and verify the mapping persists. Check an audit event for the student ID.
7. Sign in independently as the STUDENT. Navigate Programme → Subject → Published PDF, then select Preview. Confirm actual PDF pages and `DOCUMENT_READ_AUTHORIZED`. Sign in as another student without matching enrollment; verify catalogue omission **and** a direct `/read` access denial. Verify the same for expired subscription, unlocked mapping, deleted/unpublished material, and absence of STUDENT profile.
8. Inspect a previously published PDF in admin Uploads Preview and a READY preview. Check no signed URL or AWS key appears in persistent browser storage or application logs. Do not assume this PDF iframe prevents printing or downloading.

## Verification and scope boundaries

- In artifact preparation, six focused enrollment-policy tests passed and changed TS/TSX source parsed successfully. Full TypeScript builds and AWS/Cognito browser tests could not run here because project npm dependencies and live Mac services are unavailable.
- Existing Subscriber *mock-only* gender, photo editing and CSV-import screens are not converted to secure production storage in this increment. The new production subscriber screen handles **identity and access grants**. Their approved long-term workflows must be implemented in separate, reviewed increments rather than falsely represented as persisted controls; do not treat this update as the completed Subscribers module.
- Current AWS developer access is broad. For production, service identity requires narrowly scoped `cognito-idp:AdminGetUser` on the configured pool, no administrative access keys, and separate AWS permissions for PDF processing.
- Signed S3 links remain usable until expiration; authorization revocation blocks *new* links, not existing issued links. The viewer is not DRM. S3 encryption, malware scanning, short-lived URLs and audits remain separately required.
- No full regression, CI checks, runtime provisioning, visual regression, deployment, or push have occurred. The final delivery gate remains blocked pending local Mac checks, student-positive/negative tests, and explicit GitHub approval.
