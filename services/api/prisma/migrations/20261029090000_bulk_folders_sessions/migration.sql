-- Additive administrative content and session capabilities; retain existing records.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "Document" ADD COLUMN "folderId" UUID,
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "DocumentFolder" (
  "id" UUID NOT NULL, "courseId" UUID NOT NULL, "programmeId" UUID NOT NULL,
  "subjectId" UUID NOT NULL, "name" TEXT NOT NULL, "nameKey" TEXT NOT NULL,
  "hidden" BOOLEAN NOT NULL DEFAULT false, "locked" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0, "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentFolder_programmeId_subjectId_nameKey_key" ON "DocumentFolder"("programmeId","subjectId","nameKey");
CREATE INDEX "DocumentFolder_courseId_programmeId_subjectId_idx" ON "DocumentFolder"("courseId","programmeId","subjectId");
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DocumentFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TYPE "LiveSessionStatus" AS ENUM ('DRAFT','SCHEDULED','POSTPONED','CANCELLED','COMPLETED');
CREATE TYPE "LiveSessionPlatform" AS ENUM ('DOCTUTORIALS_APP','YOUTUBE','ZOOM','DTLC');
CREATE TABLE "LiveSession" (
  "id" UUID NOT NULL, "courseId" UUID NOT NULL, "programmeId" UUID NOT NULL,
  "subjectId" UUID NOT NULL, "topic" TEXT NOT NULL, "facultyName" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3) NOT NULL,
  "platform" "LiveSessionPlatform" NOT NULL, "youtubeUrl" TEXT,
  "remarks" TEXT, "status" "LiveSessionStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3), "revision" INTEGER NOT NULL DEFAULT 0,
  "createdById" UUID NOT NULL, "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LiveSessionPlan" (
  "sessionId" UUID NOT NULL, "planId" UUID NOT NULL,
  CONSTRAINT "LiveSessionPlan_pkey" PRIMARY KEY ("sessionId","planId")
);
CREATE INDEX "LiveSession_courseId_programmeId_startAt_idx" ON "LiveSession"("courseId","programmeId","startAt");
CREATE INDEX "LiveSession_publishedAt_startAt_status_idx" ON "LiveSession"("publishedAt","startAt","status");
CREATE INDEX "LiveSessionPlan_planId_sessionId_idx" ON "LiveSessionPlan"("planId","sessionId");
ALTER TABLE "LiveSessionPlan" ADD CONSTRAINT "LiveSessionPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
