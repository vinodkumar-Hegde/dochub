# DocHub — Secure Student PDF Study Workspace

## Architecture

- Existing private S3 PDF originals and server-rendered JPEG previews are unchanged.
- An authenticated student receives only pages of the selected published version after **every** server request rechecks Course, Programme, Subject, Plan, academic availability, publication and subscription dates.
- `DocumentStudyPage` stores only bounded normalized ink strokes (JSON), read flags, revisions and timestamps, scoped to a student, document, version and page. No PDF or S3 object is modified.
- GET summary/page; PUT page annotation with revision; PATCH per-page read flag with audit event. Mutations require same-origin JSON requests. Authentication uses existing secure HttpOnly student session cookies; the employee Cognito path is unchanged.
- Version replacement preserves earlier notes in historical rows; the new published version has its own notes. The UI does not merge notes across different PDF versions automatically.
- Thumbnail images use existing authorized JPEG endpoints with lazy viewport fetching and revoked Blob URLs. No token, signed PDF URL, or S3 key is stored client-side.

## Student controls

- Left page-preview rail with each page's Mark read/Read tick and progress percentage.
- Pen, highlighter, stroke eraser, undo, five ink colors, read mark.
- Centered previous/next buttons, arrow keys, touch-swipe navigation in Navigate mode, fit page / fit width / actual image size, zoom ±.
- Ink is saved at stroke completion; concurrent updates use revision checks rather than silently overwriting notes.
- Watermark `DocTutorials · <student email>` appears across every student viewing page and permitted print-layout page. The viewer does not render protected images until the student's email is verified by the authenticated API.
- If the PDF's Download permission is enabled, the existing endpoint returns an **original PDF**; this viewer's on-screen watermark is **not embedded in that downloaded binary**. If all exported PDFs must carry an irreversible watermark, implement a separate worker-side PDF-stamping pipeline before enabling original downloads. Do not claim otherwise.
- Student session table is reused in My Learning and the Sessions module, with Today / Upcoming / Completed / All and status-specific colors.

## Migration and operational checks

Migration `20261029193000_student_study_pages` is additive. It creates a student-owned study page table with foreign keys to User, Document and DocumentVersion. It does not modify or delete existing subscriptions, materials, archived academic records, preview objects or original PDFs.

After the guarded local installer returns SUCCESS, restart the one existing DocHub API watcher; do not start a second listener on port 3011. Reload existing Vite frontend on 5190.

Perform these acceptance checks in the browser with a real, authorized student:

1. Open a published 3+ page PDF that has secure previews. Confirm left thumbnails appear as you scroll.
2. Draw in two pages, erase one stroke, reload browser, confirm ink and read ticks are restored on those pages.
3. Test page next/back at footer center, arrow keys, touch swipe in Navigate mode, zoom controls and all three fit modes on Safari desktop/mobile.
4. Verify watermark text contains the currently authenticated student email on each viewed page and print layout when allowed.
5. Switch student account and verify zero access to the other student's notes; remove the subscription and verify study API now returns 403 or 404 without leaking notes or page images.
6. Open My Learning in an active Programme and Sessions app; confirm the same tabular date/status presentation, Today/Upcoming/Completed/All filters and YouTube links.
7. Publish a replacement PDF version and ensure old annotations cannot attach to its different version ID.
8. Verify that Download and Print flags remain controlled by existing folder/file policy, with Share unavailable.

## Release constraints

The local installer runs Prisma Client generation, focused tests, API typecheck, API build, frontend build and only then deploys the additive migration. A failed pre-migration gate restores the exact affected source files. Any failure during migration is reported without automatic source rollback because the database migration may have been committed.

Pending until Mac verification: real Prisma generated types/build, PostgreSQL migration and rollback, image-preview response and annotation save/reload, Safari/touch visual regression, WCAG 2.2 AA interaction checks and performance on long documents. Do not push to GitHub without explicit approval.
