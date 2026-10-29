CREATE TABLE "AcademicCourse" (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AcademicCourse_nameKey_key" ON "AcademicCourse"("nameKey");
CREATE UNIQUE INDEX "AcademicCourse_code_key" ON "AcademicCourse"("code");

CREATE TABLE "AcademicPlan" (
  "id" UUID NOT NULL PRIMARY KEY,
  "courseId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicPlan_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademicCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AcademicPlan_courseId_nameKey_key" ON "AcademicPlan"("courseId", "nameKey");
CREATE INDEX "AcademicPlan_courseId_idx" ON "AcademicPlan"("courseId");

CREATE TABLE "AcademicSubject" (
  "id" UUID NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AcademicSubject_nameKey_key" ON "AcademicSubject"("nameKey");

CREATE TABLE "AcademicProgramme" (
  "id" UUID NOT NULL PRIMARY KEY,
  "courseId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicProgramme_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademicCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AcademicProgramme_courseId_nameKey_key" ON "AcademicProgramme"("courseId", "nameKey");
CREATE INDEX "AcademicProgramme_courseId_locked_idx" ON "AcademicProgramme"("courseId", "locked");

CREATE TABLE "ProgrammePlan" (
  "programmeId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  CONSTRAINT "ProgrammePlan_pkey" PRIMARY KEY ("programmeId", "planId"),
  CONSTRAINT "ProgrammePlan_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgrammePlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AcademicPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ProgrammeSubject" (
  "programmeId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  CONSTRAINT "ProgrammeSubject_pkey" PRIMARY KEY ("programmeId", "subjectId"),
  CONSTRAINT "ProgrammeSubject_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgrammeSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "AcademicSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
