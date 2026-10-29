# Bulk user import and duplicate protection — 29 October 2026

## 1. Implemented functionality

Bulk upload creates new students only. Email addresses are compared after trimming spaces and lowercasing, both within a file and against all existing identities (including staff, disabled and expired accounts). Any invalid/duplicate row rejects the complete file; existing profiles, phone numbers and subscriptions are never overwritten. Re-uploading an imported file is rejected rather than updated. Manual Add student also rejects an existing email; Edit access and Assign selected remain the supported ways to modify existing subscriptions.

A live authenticated preflight checks duplicate emails, course consistency, subscription windows and approved mappings before enabling Import. The commit route repeats the check inside a serializable transaction; a functional unique database index closes concurrent-create races. Repeating the same upload cannot silently create another account. The UI gives row-specific issues and disables Import for stale, pending or failed validation. Replacing/reselecting files resets earlier file state, handles asynchronous read failures, and ignores stale read/validation responses.

The template uses the selected course and date defaults. Blank optional phones are accepted consistently. CSV header/column alignment, length and duplicate-header checks prevent malformed data from becoming generic backend errors. Programme/course changes select the mapped subjects/plans for import. The scrolling drawer no longer shrinks previews and issue lists until unreadable.

## 2. Modules/files changed

- Frontend: `src/SubscribersWorkspace.tsx`, `src/subscriber-csv.ts`, `src/subscribers-client.ts`, `src/subscribers.css`.
- API: `services/api/src/subscribers.ts`, new `services/api/src/subscriber-import-policy.ts`, corresponding policy test, new `services/api/tests/subscriber-import.integration.ts`, and integration test script in `services/api/package.json`.
- Database: comment documenting normalized-email uniqueness in `services/api/prisma/schema.prisma`; new migration `20261029173000_unique_normalized_user_email/migration.sql`.
- Tests: existing CSV and date tests extended in `tests/unit/subscriber-csv.test.ts` and `tests/unit/subscriber-csv-dates.test.ts`.
- Documentation: this report. Previous staged PDF-performance changes preserved separately from this task's unstaged changes.

## 3. Bugs/root causes addressed

The former import was an upsert: matching users had their names/phones/grant dates updated, and a replacement flag could revoke prior subscriptions. There was no unique email database constraint, so duplicate prevention depended on application transaction behavior. CSV template values were hardcoded to NEET PG and fixed dates, which could conflict with the selected mapping. File error paths could retain older preview rows, changing programme cleared import defaults, and blank phone/oversized fields did not align with backend validation. The inherited flex drawer shrank preview/error regions when additional content appeared.

User-directed behavior change: the bulk import replacement option was removed from this creation workflow. Existing access-editing and bulk-assignment workflows are retained. Legacy API clients sending `replaceExisting:true` receive an explicit error directing them to Edit access; `false` remains accepted for compatibility.

## 4. Tests and results

- Frontend TypeScript/Vite production build: PASS (rebuilt after the final CSS adjustment).
- API strict typecheck and production build: PASS.
- Full API unit suite: 103/103 PASS.
- Full frontend unit suite: 33/33 PASS.
- Full local database/API integration suite: 18/18 PASS, including prior publication tests and 10 import checks (parent/subtests included).
- Import integration covered successful creation/enrollments, same-file reupload, case/space duplicates, mixed new/existing batch rejection, preservation of original profiles/grants, employee/disabled duplicates, invalid course/row/replacement requests, manual creation duplicate denial, the supported 200-row file, over-limit rejection, super-admin authorization, and simultaneous normalized-email creation.
- Existing normalized-email collision audit: zero duplicate groups. Migration deployed successfully to local PostgreSQL. Concurrent creation test confirms exactly one identity succeeds and the other receives a database uniqueness error.
- Authenticated live browser: existing email gives a row error and disabled Import; repeated file email gives a row error and disabled Import; replacing with a valid new-student file gives validation success and enabled Import. No browser Import action was submitted. Temporary test tab was closed; the user's main tab retained.
- Preview records and enrollments in database tests rolled back; the isolated concurrency test removed only its own synthetic identity. Browser fixtures used temporary CSVs and did not change users. Screenshots kept in the local visualization directory, outside Git, to avoid committing subscriber contact details.
- Final whitespace/diff check: PASS. No dependency changes; dependency audits were not repeated. Existing API security findings in the previous delivery report remain unresolved. No lint command is configured, so lint is not claimed.

## 5. Security/performance

Validation and import remain SUPER_ADMIN-only; raw SQL uses Prisma parameter binding. Server validation remains authoritative regardless of UI state. Dates, course/programme/subject/plan grants and mapping checks are preserved. There is no credential issuance, password reset or activation-email send in import.

Database uniqueness is `lower(btrim(email))` for non-null `User.email`. NULL emails remain supported. The SQL expression index is intentionally defined in a migration because Prisma's schema cannot represent it directly. Do not replace it with a case-sensitive email constraint or drop it via an unreviewed schema synchronization. Existing contact values are not rewritten by the migration. A batch uses one normalized-email query, approved mapping checks and a bounded transaction. Existing limits remain 200 students and 4,000 grants per request, so large cohorts must be split into appropriate files.

Duplicate identity means the same normalized email. Shared names or phone numbers do not imply duplicate identities. No provider-specific email rewriting (Gmail dots/plus aliases) is applied.

## 6. Remaining issues/risks

One course per file remains required so an approved programme and grants cannot be ambiguously applied across courses. The full file is rejected if any row fails; rows are never silently skipped. Phone numbers are optional contact data, not identity keys. This task does not add XLSX support or an asynchronous large-cohort import service.

Migration intentionally stops if another environment has pre-existing normalized-email collisions. Audit and explicitly resolve those identities before applying; never automatically merge or delete accounts. Existing four high-severity API dependency findings, release lint configuration, broad responsive/accessibility regression and production/staging validation remain release gates.

## 7. Local verification status

Local API, frontend builds/tests, migration and live-browser preflight checks pass. Existing staged work and untracked project material were preserved; source files under the synced project `sources/` were not modified. No production database or cloud infrastructure was changed.

## 8. GitHub push readiness

No push performed. Complete remaining release gates and obtain explicit owner approval before any GitHub push. New environments must deploy the reviewed migration before rolling out the import API/UI. To roll back application code, retain the unique email index so duplicates cannot be recreated; restoring the previous upsert behavior would conflict with the user's new requirement.
