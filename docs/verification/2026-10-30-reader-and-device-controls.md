# Reader and device controls verification

Frontend production build and API typecheck pass. API unit tests, 54 PostgreSQL integration tests, and 44 frontend unit tests pass.

Browser checks use mocked API responses and real Chrome. They cover a 2,000-page reader, direct navigation to page 2,000, page-turn mode, returning to continuous scrolling, bounded mounted page elements, and layouts at 390×844, 768×1024 and 1024×768. Screenshots: `student-continuous-pdf-mobile.png` and `analytics-readable.png`.

The reader loads protected page images rather than the original PDF. It mounts only a visible window and keeps at most ten cached images / 24 MiB, with two concurrent page operations. Notes remain available through the Notes action. Phone page-turn mode supports horizontal swipes.

Uploads update quietly every 2.5 seconds while processing and every five seconds otherwise. Student materials synchronize every five seconds while visible and on focus. Publication still waits for scanning and complete page preparation.

## Local large-file preparation benchmark

Run from `services/api` with `node --import tsx scripts/benchmark-large-pdf.mts`. Requires `pdfinfo`, `pdftoppm` and `clamscan`. Temporary input/render files are removed on completion; results and first/last page images are written under `/tmp`.

Measured input: a valid, simple text, 2,000-page PDF padded sparsely to 1,073,741,824 bytes. Real PDF inspection, full-file streaming SHA-256, ClamAV scan and Poppler rendering passed. All 2,000 page JPEGs reached the mocked storage sink exactly once. Rendering took 14.1 seconds; total including scanning took 96.7 seconds. Peak Node RSS was 156 MiB (does not include child processes). See `large-pdf-benchmark.json`.

This is not a real S3 upload throughput test or an image-heavy scanned-document benchmark. File complexity, server resources and network speed affect actual time.

## Session controls

The database migration `20261030030000_two_device_sessions` adds hashed device identity. Admission is serialized per account; a third active device receives HTTP 409. Reauthentication on the same device rotates that session. Logout frees its slot. Expired, revoked or idle sessions beyond the existing 30-minute idle timeout do not occupy slots. Integration tests exercise admission, rejection, rotation, logout and idle expiry.

Only `SUPER_ADMIN` may edit or change publication of completed sessions or sessions whose end time has passed. Student responses become read-only when the session ends. Both API and interface enforce these rules.
