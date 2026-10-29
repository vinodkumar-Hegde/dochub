-- Add verified subscriber profile metadata and optimistic enrollment revision.
-- Existing users retain access and get a revision of zero.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;
ALTER TABLE "User" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "Enrollment_courseId_validUntil_userId_idx" ON "Enrollment"("courseId","validUntil","userId");
