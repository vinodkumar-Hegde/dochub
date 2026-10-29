# Uploads UX update and HTTP 500 diagnosis

## Scope
- Preserve approved V20 workspace navigation and right-side drawer.
- Reload the live academic catalogue when opening Uploads and its upload drawer.
- Display unlocked programmes with an explanatory approval/lock blocker, without relaxing backend permissions.
- Replace the native file chooser presentation with a styled drop zone, file summary, three-section hierarchy, and accessible errors.
- Provide direct navigation to Academic Mapping for changes to a programme.
- No API or database schema changes in this package.

## Known runtime issue not addressed by the UI change
A screenshot at 2026-10-29 06:35 (Asia/Kolkata) shows two independent HTTP 500 responses (document list and upload initiation). The actual server-side exceptions have not been provided, so the root cause has NOT been established. UI changes alone cannot resolve backend HTTP 500 errors.

## Targeted diagnosis
1. Keep the API running on port 3011 in a dedicated Terminal, with `AWS_PROFILE=dochub-terraform` exported. If starting it anew, use `npm run dev 2>&1 | tee /tmp/dochub-api.log` in `services/api`.
2. In the browser: Uploads > Refresh; try upload once. In the server Terminal, capture only `req.log.error` lines for `/v1/documents` (GET) and `/v1/documents/uploads` (POST), including the exception `code`, `message`, and stack. Redact tokens, secrets, S3 presigned URLs, and user identifiers.
3. If the GET fails, check the Prisma `document.findMany` and `document.count` query and whether the running Prisma Client matches the current schema and migrations.
4. If the POST fails but GET succeeds, examine AWS credentials, S3 bucket name and region, `CreateMultipartUpload` permissions, and KMS access; do not change IAM speculatively.
5. Before trying a second upload, inspect the list for already-created UPLOADING or QUEUED records to avoid duplicate uploads.

## Verification
- `node --experimental-strip-types --test tests/unit/upload-mapping.test.ts` (four targeted policy-projection tests).
- `npm run build` from project root.
- Browser: course, programme, mapped subjects and plans visible; unmapped/unlocked programme blocked; locked mapping accepts a file; keyboard reachable file picker; responsive narrow viewport.
- HTTP 500 root cause remains open until live server error log is available.
- No GitHub push without local verification and explicit approval.
