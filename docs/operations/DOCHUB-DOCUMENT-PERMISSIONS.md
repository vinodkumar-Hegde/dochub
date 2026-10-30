# Document permissions and preview backfill

Administrators configure student download and print permissions independently; both default to off. The student reader uses protected rendered pages. Download and print actions enforce document permissions and current enrollment. Copies inherit the switches and have independent preview objects. Browser-rendered content can still be captured by screenshots; watermarking identifies the viewer.

API page delivery checks current authorization on every request. Optional private CDN delivery uses short-lived signed grants; see [private delivery](../decisions/PDF-PUBLICATION-AND-PRIVATE-CDN.md) for expiry, configuration and revocation behaviour.

## Backfill historical previews

For existing READY or PUBLISHED versions without prepared previews, run one backfill process after migrations and image deployment. Use the configured workload IAM role and current ClamAV signatures:

```sh
docker compose --env-file deploy/.env run --rm api node dist/backfill-document-previews.js
```

The backfill scans and renders eligible files, uploads private images and marks previews ready after successful completion. It preserves publication state and access grants. Run only one backfill process at a time. Keep S3 private and grant scoped object/version access, preview writes and applicable KMS permissions. Plan temporary disk, compute and derivative storage for the selected files.

## Permission checks

Verify entitled student preview access, download denial with the switch off, permitted download with it on, and independent print controls. Test expired subscriptions, hidden/unpublished documents, wrong plans, replaced versions and document copies. Check audit records and confirm revoked users cannot obtain new read grants.
