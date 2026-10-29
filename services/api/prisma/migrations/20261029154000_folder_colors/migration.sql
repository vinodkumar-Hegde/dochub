BEGIN;
-- Additive, non-destructive color preference for subject folders.
ALTER TABLE "DocumentFolder" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'blue';
-- Give existing folders stable, varied colors. The document and permission data are untouched.
UPDATE "DocumentFolder"
SET "color" = CASE (ASCII(SUBSTRING(MD5("id"::text), 1, 1)) % 6)
  WHEN 0 THEN 'blue'
  WHEN 1 THEN 'violet'
  WHEN 2 THEN 'teal'
  WHEN 3 THEN 'amber'
  WHEN 4 THEN 'rose'
  ELSE 'slate'
END;
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "document_folder_color_allowed"
  CHECK ("color" IN ('blue', 'violet', 'teal', 'amber', 'rose', 'slate'));

COMMIT;
