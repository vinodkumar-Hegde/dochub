-- Increase supported annotation/read-marker page range to PostgreSQL INTEGER bounds.
-- Existing values and uniqueness constraint remain unchanged.
ALTER TABLE "DocumentStudyPage" DROP CONSTRAINT IF EXISTS "DocumentStudyPage_page_check";
ALTER TABLE "DocumentStudyPage" ADD CONSTRAINT "DocumentStudyPage_page_check" CHECK ("page" >= 1);
