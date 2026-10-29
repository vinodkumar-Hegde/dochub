-- Student annotations and read markers never modify or expose protected PDFs.
CREATE TABLE "DocumentStudyPage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "page" INTEGER NOT NULL,
    "strokes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "strokeCount" INTEGER NOT NULL DEFAULT 0,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentStudyPage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentStudyPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DocumentStudyPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DocumentStudyPage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DocumentStudyPage_page_check" CHECK ("page" BETWEEN 1 AND 2000)
);
CREATE UNIQUE INDEX "DocumentStudyPage_userId_documentId_versionId_page_key" ON "DocumentStudyPage"("userId", "documentId", "versionId", "page");
CREATE INDEX "DocumentStudyPage_documentId_versionId_idx" ON "DocumentStudyPage"("documentId", "versionId");
