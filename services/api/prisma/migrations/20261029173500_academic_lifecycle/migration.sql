BEGIN;
-- Additive migration: no data is deleted; existing subscriptions start immediately.
ALTER TABLE "Enrollment" ADD COLUMN "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Enrollment_userId_activeFrom_validUntil_idx" ON "Enrollment"("userId", "activeFrom", "validUntil");
ALTER TABLE "AcademicCourse" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "accessLocked" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "AcademicPlan" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "accessLocked" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "AcademicSubject" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "accessLocked" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "AcademicProgramme" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "accessLocked" BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE TABLE "AcademicFaculty" ("id" UUID NOT NULL, "name" TEXT NOT NULL, "nameKey" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0, "hidden" BOOLEAN NOT NULL DEFAULT FALSE, "accessLocked" BOOLEAN NOT NULL DEFAULT FALSE, "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AcademicFaculty_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AcademicFaculty_nameKey_key" ON "AcademicFaculty"("nameKey");
ALTER TABLE "LiveSession" ADD COLUMN "facultyId" UUID;
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "AcademicFaculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LiveSession_facultyId_idx" ON "LiveSession"("facultyId");
COMMIT;
