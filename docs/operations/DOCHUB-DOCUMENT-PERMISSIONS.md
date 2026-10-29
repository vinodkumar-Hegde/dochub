# DocHub document controls — controlled integration candidate

## Requirement

Administrators configure **Student download** and **Student print** for each file.
Both are **OFF by default**, including previously uploaded PDFs. Student sharing
is not provided. Admin preview stays available.

## Enforced boundaries

- PostgreSQL `Document.allowDownload = false`, `Document.allowPrint = false` by default.
- `PATCH /v1/admin/documents/:id/organize` accepts either permission only from an authenticated Super Admin or owning Content Manager. Revision precondition and audit logging apply.
- Student `GET /v1/documents/:id/read` returns a **pages** manifest and **never** an original-PDF S3 URL, regardless of policy settings. Staff admin read still returns a short-lived PDF preview URL.
- Each `GET /v1/documents/:id/preview/pages/:page?versionId=...` requires a bearer token and re-evaluates document visibility, programme mapping, role and exact active enrollment. JPG is streamed from private S3 with no-store headers and no signed URLs.
- The PDF worker writes private JPEG page renditions **after** mandatory antivirus scanning and PDF validation, **before** the version reaches READY.
- `GET /v1/documents/:id/download` denies students unless `allowDownload = true`; staff may download original PDFs under their admin role. The returned signed URL is valid for 60 seconds.
- Student printing is a browser operation over the same authenticated JPEG pages, and appears only if `allowPrint = true`. Print permission does not grant the original-PDF download endpoint.
- Document copies inherit both switches and get independent preview image objects. A source file's removal does not break the copy.
- All successful read and download grants are auditable. The page endpoint checks entitlement on every request; it does not produce one audit event per page, avoiding audit amplification.

## Historical PDFs (mandatory one-time step)

The migration sets `DocumentVersion.previewReady` to false for existing PDFs.
After the backend/worker build and migration, run from `services/api`:

```bash
AWS_PROFILE=dochub-terraform AWS_REGION=ap-south-1 npx tsx src/backfill-document-previews.ts
```

Only already-scanned READY or PUBLISHED versions without renditions are selected.
The script re-scans files, generates images, uploads private objects and sets
`previewReady=true` only after all pages succeed. It is idempotent and does not
change published status, folder assignments, access grants, or PDF source objects.

Do **not** run the backfill concurrently from multiple terminals. Do not add
S3 public bucket policies. The IAM role executing the worker/backfill needs
least-privilege GetObject and PutObject on private document/preview prefixes,
plus KMS encrypt/decrypt as applicable. Preview derivatives add S3 storage cost.

## Important browser limits

This is stronger than hiding toolbar buttons: restricted students never receive
the original PDF. However, **no standard browser can reliably prevent screenshots,
photographs, browser inspection of rendered page images, or print-to-PDF when
printing is explicitly allowed**. This is not DRM. If legal-grade copy prevention
is required, a specialized DRM/screen-capture-controlled platform is needed.

## Local release gates

1. Confirm existing source and current local edits before applying update files.
2. Apply new additive migration once; `prisma generate`, API TypeScript check/build;
   frontend TypeScript check/build; run focused document-permissions policy tests.
3. Restart **one** API, **one** worker and existing frontend. Backfill old PDFs.
4. Confirm the admin list shows both controls OFF on every existing PDF and they
   persist after a refresh. Enable and disable independently. Audit events appear.
5. Authenticate a real STUDENT account with an exact active enrollment (currently
   paused by request) and confirm page preview works, **no PDF signed URL in API
   response**, download returns 403, print/share actions are absent.
6. Enable Download on one file; verify only its entitled student can download.
   Turn it off and verify newly requested downloads return 403.
7. Enable Print alone; verify all pages can be printed but original download is
   still denied. Disable and verify the action disappears after refresh.
8. Test hidden/locked/unpublished/deleted PDFs, expired grants, wrong plans,
   invalid pages, unauthorized users, replacement and independent file copies.
9. Run the final integrated release gates before requesting owner approval.

## Outstanding limitations

The student login is intentionally paused, so the positive student PDF browser
flow cannot currently be tested end-to-end. This implementation candidate must
not be called production-ready until student auth is resumed and tested against
both subscribed and unsubscribed identities.
