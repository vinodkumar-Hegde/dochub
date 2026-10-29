-- Additive, default-deny subject folder permissions. No document or folder deletion.
ALTER TABLE "DocumentFolder"
  ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "allowPrint" BOOLEAN NOT NULL DEFAULT FALSE;
