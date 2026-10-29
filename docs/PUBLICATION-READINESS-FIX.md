# Publication readiness feedback — 29 October 2026

- Implemented: document list exposes server-calculated `latestVersion.canPublish`, using the existing secure-preview publication policy. Uploads displays Preparing PDF pages, explains automatic status updates, polls incomplete READY versions every 10 seconds, and disables Publish until ready. Upload confirmation and publication conflict wording explain next steps.
- Files: `src/UploadsWorkspace.tsx`, `src/uploads-client.ts`, `services/api/src/documents.ts`, and this report.
- Root cause: UI treated READY as sufficient; backend additionally requires secure previews and a valid positive page count. This allowed a misleading readiness label and a premature publication attempt.
- Verification: frontend strict TypeScript/production build passed; API typecheck passed; five pdf-preview-job-policy tests passed. Live authenticated browser showed the pending status and disabled Publish control; desktop visual inspection completed.
- Security: server publication enforcement retained. No credentials or AWS settings changed. API adds a readiness boolean and previewReady metadata only to the authenticated admin listing.
- Performance: existing 10-second refresh also covers READY versions missing previews; database listing selects one additional boolean. Pagination behavior unchanged.
- Remaining limits: background worker completion and end-to-end publication were not tested; no document was published or changed for testing. Full release regression, lint/security checks and responsive visual regression were not run for this focused local change.
- Local status: focused checks passed; changes available through the local development server. This checkout has no Git repository, so no Git diff/branch verification was possible.
- GitHub readiness: not approved for push; no push performed. Establish controlled source history and complete release gates before requesting owner approval.
