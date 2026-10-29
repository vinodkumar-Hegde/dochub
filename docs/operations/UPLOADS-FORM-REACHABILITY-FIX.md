# DOCUSEND Uploads form reachability repair (2026-10-29)

## Observed behaviour and confirmed cause
The screenshot shows a locked NEET PG > MIQ programme, but the Subject selector still reads "Select mapped subject" and no student-plan checkbox is visible. The selected PDF does not make the form valid; upload requires a subject and at least one explicitly chosen plan.

The V20 Uploads drawer is `display:flex; flex-direction:column; overflow:auto`. With narrow viewport heights, the plan grid can flex-shrink and collapse. The authentication banner is `z-index:99999` and covers the bottom of the drawer, including action controls.

## Changes
- In Uploads CSS, prevent drawer sections (especially the student-plan grid) from flex-shrinking; ensure the form scrolls instead.
- Make the submit section sticky and scroll-accessible.
- Hide the bottom-right authentication banner only while the upload drawer is open (it reappears on close).
- Add an explicit list of missing required selections before upload.
- Preserve deliberate user selection of subject and plan; NO automatic entitlement grants, no changes to backend access checks or S3 permissions.
- No new files in the application runtime, no schema/API changes.

## Local verification
- `node --experimental-strip-types --test tests/unit/upload-mapping.test.ts`: 4/4 pass.
- Updated TSX syntax parsed successfully with TypeScript.
- Full application build and browser transfer NOT run in packaging environment.

## Verify on Mac
1. From project root, review `git diff -- src/UploadsWorkspace.tsx src/uploads.css`; run `npm run build`.
2. Keep the existing API and Vite running. Reload the Uploads page.
3. Choose Course NEET PG > approved Programme MIQ > Subject Anatomy > tick the intended student plan > select PDF > title.
4. Confirm `Start upload` is enabled, click it ONCE, verify Uploads table and S3/queue status.
5. If it then fails, inspect the precise API request and backend exception; do not retry until you check if a document row exists. Document POST errors may still require a separate backend fix.

## Release status
Source/UI validation only. Live upload, queue processing, security, and production release gates pending. No GitHub push.
