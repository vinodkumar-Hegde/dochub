# DOCUSEND — Academic Mapping production increment

## Scope and design governance

Retains V20 Super Admin tile layout, in-page course/programme selection, plan and subject tick mapping, and approved mapping lock. Replaces the Academic Mapping module's React seed-state mutations with authenticated PostgreSQL-backed APIs. Other V20 modules are not converted by this increment and must not be interpreted as production-connected.

## Modules

- `services/api/prisma/schema.prisma` — six academic mapping models (course, plan, subject, programme, programme-plan, programme-subject).
- `services/api/prisma/migrations/20261028231500_academic_mapping/migration.sql` — additive schema migration. No existing rows are overwritten.
- `services/api/src/academic.ts` — role-gated, validated `/v1/academic/*` routes.
- `services/api/src/academic-policy.ts` — canonical names, cross-course mapping validation, lock preconditions.
- `services/api/src/academic-policy.test.ts` — focused invariant tests.
- `services/api/src/server.ts` — registers routes and permits PUT in allowed CORS methods.
- `src/academic-client.ts` — typed catalog API client.
- `src/auth-client.ts` — authenticated JSON request helper using existing in-memory Cognito access token.
- `src/AdminWorkspace.tsx` — connects approved mapping UI to authenticated API, adds visible loading/errors and disables concurrent edits.
- `src/academic.css` — compact error/loading presentation; no redesign.

## API (v1)

All endpoints require valid Cognito access token and enabled PostgreSQL user record. Reads allow `SUPER_ADMIN` and `CONTENT_MANAGER`; writes require `SUPER_ADMIN`.

| Method | Path | Payload |
|---|---|---|
| GET | `/v1/academic/catalog` | none; returns courses, plans, subjects, programmes with planIds/subjectIds, lock and revision |
| POST | `/v1/academic/courses` | `{ "name": "NEET PG" }` |
| POST | `/v1/academic/subjects` | `{ "name": "Anatomy" }` |
| POST | `/v1/academic/plans` | `{ "courseId": "UUID", "name": "NEET PG Complete" }` |
| POST | `/v1/academic/programmes` | `{ "courseId": "UUID", "name": "Foundation Programme" }` |
| PUT | `/v1/academic/programmes/:id/mapping` | `{ "revision": 0, "planIds": ["UUID"], "subjectIds": ["UUID"] }` |
| PUT | `/v1/academic/programmes/:id/lock` | `{ "revision": 1, "locked": true }` |

Conflict behavior: 409 on duplicate names and stale edits, 423 for editing locked programme, 400 for invalid/cross-course mapping. Locking requires at least one assigned plan and one subject. All changes create AuditEvent records in the same database transaction.

## Safe local application

1. Review the ZIP entries and check your local file changes. Do **not** blindly overwrite customized files.
2. Extract this package at the single authoritative root `~/Desktop/AI_RESEARCH/dochub`.
3. Verify the local PostgreSQL container and API `.env` used by the already functioning Super Admin login. Never print secret values in chat.
4. From `services/api`, run `npm run db:generate`, `npm run db:migrate`, `npm run typecheck`, `npm test`, `npm run build`.
5. From the project root, run `npm run build`.
6. Restart API and frontend dev servers (ports 3011 and 5190 in the verified local setup) and log in as authorized Super Admin.
7. Academic Mapping starts empty intentionally. Create a course, plan, subject and programme via buttons; tick plan and subject; lock; reload and check persistence. Do not copy V20 sample data into the real database automatically.

## Regression checks

- Admin can create course, plan, subject and programme; names normalized and duplicates rejected.
- Plan under wrong course rejected; unknown/duplicated subject IDs rejected.
- Multiple plan/subject mappings persist across page reloads.
- Lock requires mapped plan and subject; locked programme rejects updates; admin can unlock.
- Two admins editing same revision: stale change fails with 409; winner preserved.
- Content Manager can read catalog but cannot create, map, lock or unlock; Student and Faculty cannot access admin catalog.
- All mutations record actor ID and target ID in AuditEvent.
- Previously deployed document APIs, Cognito sign-in, PDF worker, S3 and SQS behavior unaffected.
- Confirm approved tile presentation at desktop/mobile widths.

## Production limitations and follow-ups

- The rest of V20 (Uploads, Sessions, Subscribers, Employees, Analytics and Student views) still contains prototype data/state and requires independent integration work. This increment deliberately does not silently modify those workflows.
- Legacy Enrollment and Document use string academic identifiers; link migration to authoritative academic IDs must be designed and verified before data migration or enforcing additional foreign keys.
- Initial catalog API loads all taxonomy rows. Introduce pagination and search for large institutional catalogs.
- Per-operation Idempotency-Key for creates is not implemented; database unique constraints reject duplicates and revision checks prevent stale mapping overwrites. Add persistent idempotency records before public multi-client mutation workflows.
- No on-machine DB migration, browser regression or end-to-end permission test was run during package creation; run gates locally before delivery acceptance.
- No GitHub push is included or authorized.
