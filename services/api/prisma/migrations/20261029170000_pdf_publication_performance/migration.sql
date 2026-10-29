ALTER TABLE "DocumentVersion"
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedObjectVersionId" TEXT,
  ADD COLUMN "verificationPolicy" TEXT,
  ADD COLUMN "publishRequestedById" UUID,
  ADD COLUMN "publicationFailure" TEXT;
CREATE INDEX "DocumentVersion_pending_publication_idx" ON "DocumentVersion" ("updatedAt")
  WHERE "publishRequestedById" IS NOT NULL AND "state" = 'READY';
