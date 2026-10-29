CREATE TYPE "DocumentState" AS ENUM ('UPLOADING','QUEUED','PROCESSING','READY','PUBLISHED','FAILED','QUARANTINED','DELETED');
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN','CONTENT_MANAGER','FACULTY','STUDENT');
CREATE TABLE "User" (
  "id" UUID PRIMARY KEY, "identitySub" TEXT NOT NULL UNIQUE, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "UserProfile" (
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "role" "UserRole" NOT NULL, PRIMARY KEY ("userId", "role")
);
CREATE TABLE "Enrollment" (
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "courseId" TEXT NOT NULL, "programmeId" TEXT NOT NULL, "subjectId" TEXT NOT NULL, "planId" TEXT NOT NULL,
  "validUntil" TIMESTAMP(3), PRIMARY KEY ("userId","courseId","programmeId","subjectId","planId")
);
CREATE INDEX "Enrollment_userId_validUntil_idx" ON "Enrollment"("userId","validUntil");
CREATE TABLE "Document" (
  "id" UUID PRIMARY KEY, "courseId" TEXT NOT NULL, "programmeId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "state" "DocumentState" NOT NULL DEFAULT 'UPLOADING', "publishedAt" TIMESTAMP(3),
  "createdById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Document_courseId_programmeId_subjectId_state_idx" ON "Document"("courseId","programmeId","subjectId","state");
CREATE TABLE "DocumentPlan" (
  "documentId" UUID NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "planId" TEXT NOT NULL, PRIMARY KEY("documentId","planId")
);
CREATE TABLE "DocumentVersion" (
  "id" UUID PRIMARY KEY, "documentId" UUID NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "number" INTEGER NOT NULL, "state" "DocumentState" NOT NULL DEFAULT 'UPLOADING',
  "objectKey" TEXT NOT NULL UNIQUE, "objectVersionId" TEXT, "sizeBytes" BIGINT NOT NULL,
  "contentSha256" TEXT, "s3UploadId" TEXT UNIQUE, "pageCount" INTEGER,
  "failureReason" TEXT, "processingAttempt" INTEGER NOT NULL DEFAULT 0,
  "queuedAt" TIMESTAMP(3), "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentVersion_documentId_number_key" UNIQUE("documentId", "number")
);
CREATE INDEX "DocumentVersion_state_queuedAt_idx" ON "DocumentVersion"("state","queuedAt");
CREATE TABLE "AuditEvent" (
  "id" UUID PRIMARY KEY, "actorId" UUID, "action" TEXT NOT NULL,
  "targetId" UUID NOT NULL, "details" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditEvent_targetId_createdAt_idx" ON "AuditEvent"("targetId","createdAt");
CREATE TABLE "OutboxEvent" (
  "id" UUID PRIMARY KEY, "topic" TEXT NOT NULL, "aggregateId" UUID NOT NULL,
  "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3)
);
CREATE INDEX "OutboxEvent_dispatchedAt_createdAt_idx" ON "OutboxEvent"("dispatchedAt","createdAt");
