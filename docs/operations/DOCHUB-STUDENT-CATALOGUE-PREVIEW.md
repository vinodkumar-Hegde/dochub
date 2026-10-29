# Student subscriptions and protected PDF preview — operational checks

## Grant changes

Single-subscriber Edit access defaults to **Replace existing access**, which atomically replaces all of that student's grants using the existing Super Admin-only `/v1/admin/subscribers/:id/enrollments` endpoint, revision check and audit event. The *Keep other programmes* option is explicitly additive. Bulk CSV import remains additive by default; checking *Replace all existing course/programme subscriptions* makes it a transactional replacement for matched students and records the revoked-grant count in its audit event. Bulk Assign is intentionally additive.

The student catalogue is revalidated from the authenticated user's current enrollments on page activation and Refresh. The service still rechecks exact course, programme, subject, plan and subscription expiry for every PDF read and preview-page request. Old cached file titles alone do not confer access.

## PDF preview diagnosis (no user credentials or tokens in logs)

1. As the affected student, open My Learning, Refresh, and open a **published** PDF.
2. In Safari or Chrome Developer Tools → Network, inspect the response **status** for `/v1/documents/<id>/read` and `/v1/documents/<id>/preview/pages/1` (never copy cookies, tokens, signed URLs or account identifiers into tickets).
3. HTTP 401 means the session expired; 403 means active course/programme/subject/plan grants do not match; 404 means no currently visible/published document; 409 generally means there is no validated published version or `previewReady/pageCount` is missing; 503 means a protected page is unavailable in S3. HTTP 200 with an invalid content type indicates a backend media stream problem. A failed browser decode with 200 JPEG suggests a corrupt or incomplete rendered page and needs page re-rendering.
4. For 409/503, use the existing private preview-backfill procedure in `docs/operations/DOCHUB-DOCUMENT-PERMISSIONS.md` and check worker/ClamAV and private S3 JPEG page objects. Do not relax the entitlement policy or expose original PDFs as a fallback.
5. After revoking a grant, verify both catalogue and an already-known read URL immediately deny the removed course, programme, subject and plan, and verify access to any intentionally retained parallel grant.

Never clear the database or grant access based only on a client-side filter. Preserve existing PDF versions and audit events.
