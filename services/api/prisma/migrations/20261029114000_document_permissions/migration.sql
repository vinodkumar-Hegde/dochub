-- Deny export and printing by default, including all existing published PDFs.
-- Preview readiness is version-specific and is set only after verified page
-- images have been stored privately in S3.
ALTER TABLE "Document"
  ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allowPrint" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentVersion"
  ADD COLUMN "previewReady" BOOLEAN NOT NULL DEFAULT false;
