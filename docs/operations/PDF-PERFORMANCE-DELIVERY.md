# PDF publication performance delivery — 29 October 2026

## 1. Implemented functionality

- Bounded parallel Poppler batch rendering and JPEG upload, with isolated temporary directories and in-flight task draining on failures.
- Reuse of a recorded antivirus/PDF verification for the exact immutable S3 object version under the same policy on rendering retries. New/unverified/changed versions remain subject to file scanning and validation.
- Version-specific Publish when ready / cancellation controls and an audited API. Manual and deferred publication share one transactional authorization/readiness service. A pending legacy READY preview repair is queued immediately when automatic publication is requested.
- Opt-in private CloudFront JPEG delivery with short-lived signed policies, shared frontend grant renewal, credential-free CDN requests and the existing authorized API fallback when CDN is disabled.
- Additive database migrations applied successfully to the local PostgreSQL database; Prisma client regenerated.

## 2. Modules/files changed

API: `src/bounded-work.ts`, `src/document-preview-render.ts`, `src/pdf-verification-policy.ts`, `src/document-publication.ts`, `src/preview-cdn.ts`, `src/documents.ts`, `src/worker.ts`, `src/config.ts`; corresponding unit tests; `tests/document-publication.integration.ts`; `prisma/schema.prisma`; migrations `20261029170000_pdf_publication_performance` and `20261029171000_publication_intent_revision`; package manifest/lock and `.env.example`.

Frontend: `src/UploadsWorkspace.tsx`, `src/uploads-client.ts`, `src/preview-page-loader.ts`, `src/DocumentPreview.tsx`, `src/StudentStudyViewer.tsx`; `tests/unit/preview-page-loader.test.ts`.

Infrastructure/documentation: `infra/terraform/preview-cdn.tf`; `docs/decisions/PDF-PUBLICATION-AND-PRIVATE-CDN.md`; this report; `docs/verification/pdf-publication-desktop.png`. Existing stale assertion in `services/api/src/study-policy.test.ts` corrected to match the already-supported full-document page range, retaining out-of-range rejection tests. No production page limit changed.

## 3. Root causes addressed

Rendering batches and S3 uploads were sequential. Rendering retries rescanned already-verified originals. Publication required a second manual action after preparation. Historic missing previews could wait for periodic reconciliation. All student images previously streamed through the application/database authorization path without CDN offload. The existing 2,000-page test assertion contradicted the reader's current full-page implementation.

## 4. Verification

- Frontend strict TypeScript and Vite production build: PASS.
- API strict typecheck and production build: PASS.
- Full API unit suite on final implementation: 99/99 PASS. An initial run found the stale page-limit assertion (98/99); it was corrected and final full suite passed.
- Full frontend unit suite: 29/29 PASS, including grant renewal, credential isolation, revoked/changed authorization and API fallback.
- PostgreSQL/API integration: 8/8 PASS (parent plus seven subtests), including scheduling/cancellation, exactly-once publication audit, failed/quarantined/incomplete denial, revoked role/user/changed mapping/lock denial, stale replacements and live entitlement enforcement before CDN grant issuance. Fixtures created inside a rolled-back transaction; no existing documents were published by the tests.
- Real Poppler rendering test: all 25 pages uploaded exactly once through a mocked S3 client, with temporary batch cleanup and bounded upload concurrency. This verifies correctness, not production throughput.
- CloudFront policy signature verified cryptographically with an ephemeral test key. Policy scope and maximum TTL validated.
- Two additive migrations deployed locally; generated Prisma client and live API readiness response verified.
- Terraform new-file formatting and configuration validation: PASS. No plan/apply or deployed AWS verification.
- Authenticated live desktop Uploads page inspected. Scheduled statuses visible for the user's PDFs. Screenshot recorded. The user interacted with the running UI during development; their form/selection was preserved. No student browser E2E, responsive visual regression or production throughput benchmark was performed.
- `git diff --check`: PASS. Targeted source scan found no embedded AWS access keys or PEM private-key blocks. No lint command is configured; lint is not claimed.

## 5. Security/performance

Scanning, full page-completion gate, entitlement checks, private originals, independent print/download controls and annotation authorization are retained. Render concurrency defaults to 2; uploads per renderer default to 2. Reconfigure only against measured CPU/RAM/temp-storage/S3 limits. Timing events now distinguish verification and rendering.

CDN is disabled locally. It caches shared immutable page images at the edge while retaining viewer signature validation and browser no-store responses. When enabled, a previously issued grant can outlive a revocation until its configured expiry (default 60 seconds, maximum 120); this is explicitly different from immediate per-page API reauthorization. See the architecture decision for the tradeoff and deployment checks.

Dependency audits: frontend production audit reports zero vulnerabilities. API audit reports four high-severity findings in existing Prisma/config/deepmerge-ts and Zod dependencies; the new CloudFront signer is not listed. Broad dependency upgrades were not applied during this change. These findings must be triaged/remediated before a release.

## 6. Remaining issues/risks

- Background processing of the user's actual 215-page and 52-page PDFs was still pending at the visual verification point. No claim that publication completed. Existing older worker leases/jobs can continue until completion or lease expiry; an older non-watching process requires a graceful restart for new code. Do not forcibly clear active leases or run extra duplicate workers as a shortcut.
- CDN resources, signing secrets, KMS/S3 policy merging, browser CORS, edge cache behavior, production revocation behavior and operational monitoring require staging verification.
- Existing private-reader page watermarking is client-side defense in depth, not absolute copy protection. Personalized exports remain API work and need their own capacity testing.
- No 80,000-user load test, capacity proof or instantaneous availability guarantee. A documented staging load plan covers authentication, renewals, thumbnails, annotations, exports and synchronized peaks.
- No configured lint gate, full student browser E2E or responsive regression. Four API audit findings remain. Do not mark this production-ready.

## 7. Local verification/source control status

The previously unversioned checkout now has a local `feature/pdf-publication-performance` branch and a pre-change source checkpoint. Existing untracked project assets/configuration were preserved; private environment files and generated output remain excluded. Focused local checks pass as above. See the architecture decision for migration order, environment configuration, rollout and rollback.

## 8. GitHub push readiness

No remote configured and no push performed. Not release-ready: complete security remediation, lint/E2E/visual gates and staging infrastructure/capacity verification, then obtain the owner's explicit GitHub push approval.
