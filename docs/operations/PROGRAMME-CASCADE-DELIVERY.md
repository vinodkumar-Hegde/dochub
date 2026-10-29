# DocHub Programme Cascade — Integrated Delivery Candidate

## Architecture decision

Use **one existing academic schema**, not a second namespace and not duplicate mapping tables:

- `AcademicCourse` 1 → many `AcademicProgramme`.
- `AcademicProgramme` many ↔ many `AcademicPlan` through `ProgrammePlan`.
- `AcademicProgramme` many ↔ many `AcademicSubject` through `ProgrammeSubject`.
- `LiveSession` identifies one programme, one mapped subject, a derived course, and targeted plans in `LiveSessionPlan`.
- `Document` identifies one programme, one mapped subject, a derived course, and targeted plans in `DocumentPlan`.
- Existing `Enrollment` rows control student visibility. Programme membership alone does not override explicit course/subject/plan permissions.

**No schema migration or data deletion is needed for this milestone.** The six/seven existing migrations already model these associations. Historical PDFs, folders, subscriptions, audit records and sessions are preserved. Do **not** run `prisma migrate reset`, `db push --force-reset`, or drop the `public` schema. If a separate local development reset is ever required, it must be a separately approved operation after a verified backup and inventory of real records.

## Implemented API

### GET `/v1/academic/programmes/:id/context`

Authenticated `SUPER_ADMIN` / `CONTENT_MANAGER`. Returns:

```json
{
  "programme":{"id":"...","name":"...","locked":true,"mappingRevision":4},
  "courses":[{"id":"...","name":"NEET PG","code":"NEETPG"}],
  "plans":[{"id":"...","courseId":"...","name":"Clinical core"}],
  "subjects":[{"id":"...","name":"Anatomy"}],
  "canPublish":true
}
```

The course array has exactly one record under the current schema. Related plans and subjects are fetched from authoritative junction tables, not browser data.

### GET `/v1/academic/plans/:id/programmes`

Authenticated administrator. Returns mapped programmes and their course IDs; used by Uploads when the operator starts from a plan.

### POST `/v1/admin/sessions` / PUT `/v1/admin/sessions/:id`

`programmeId`, `subjectId`, `topic`, `facultyName`, dates, platform and status remain required. `courseId`, `planIds`, `mappingRevision` are optional for compatibility:

- Course is **always derived** from the locked programme.
- Omitted plan IDs inherit **all** mapped plans, whereas an explicitly selected valid subset is retained.
- Provided course ID must match the derived course.
- Provided mapping revision must match current revision, or API returns `409`.
- The database transaction verifies the mapping and writes selected `LiveSessionPlan` records and audit events.
- Publication and student calendar filtering still check live enrolments, subject, plan, publication and status.

### POST `/v1/documents/uploads`

The PDF upload metadata accepts the same optional `courseId` / `planIds` / `mappingRevision` keys. The server derives the course, checks subject and chosen plans, verifies matching folder scope, then validates the mapping **again** within the database transaction. Presigned multipart S3 logic, PDF worker, preview restrictions, download/print default deny and publication behavior are unchanged.

**Videos and rich-text notes:** The shared academic context API can serve future asset types, but the present storage endpoint remains PDF-only. Do not label non-PDF upload processing production-ready without dedicated secure storage, processing and rendering workflows.

## UI changes

- **Session editor:** Select Programme first; Course is read-only; mapped Subjects and Plans load through context API; all mapped plans default selected for new sessions, and admins can narrow the audience. Editing keeps valid existing targeting and requires reconfirmation if mapping changed.
- **Upload drawer:** Select Programme first, or optionally filter programmes by Plan. Course is read-only, Subjects and Plans inherit from the context API, and selected plans can be narrowed. Existing folder, S3, replacement and preview controls remain.
- **Browse filters:** Existing Course → Programme list filtering is unchanged, as it serves discovery rather than mutation targeting.
- **Student:** No login changes; it remains paused by prior approval. Student entitlement policies remain server-side.

## Tests and verification

Performed here:
- Seven pure targeting policy tests passed (default plans, subset, stale revision, unrelated course/subject/plan, duplicate plans, unlocked mapping, mismatched plan course).
- TypeScript/TSX syntax parsing on all touched files passed.
- Full builds and authenticated runtime browser tests **cannot be claimed here**, because the npm dependency installation in this environment was unavailable.

Required **once on Mac** after applying this single candidate:

```bash
bash scripts/verify-programme-cascade.sh
```

Then test: locked programme context, Session create/update/publish/reload, YouTube link, Upload PDF with inherited mapped course/subject/plans, manually narrowed plans, revoked or stale mapping returns 409, eligible/ineligible student visibility when student login is restored. Recheck Download/Print both remain Off.

## Risks and delivery controls

- The existing schema uses text IDs in some legacy document/enrollment columns and UUIDs in the academic tables. No unsafe in-place type conversion or foreign-key migration is included. Constraint hardening must begin with a data audit and separate reviewed migration.
- Concurrent map edits are protected through a supplied mapping revision and transaction revalidation; programme mapping changes after publication can affect student access through existing entitlement checks.
- Browser builds and a real authenticated transaction remain mandatory release gates.
- No code has been pushed to GitHub. Local Git initialization and clean source-control delivery remain outstanding.
