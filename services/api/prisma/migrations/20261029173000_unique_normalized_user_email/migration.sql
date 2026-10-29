-- Fail rather than merge or delete legacy identities. NULL emails remain allowed.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE email IS NOT NULL GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized user emails require explicit resolution before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "User_email_normalized_unique" ON "User" (lower(btrim(email))) WHERE email IS NOT NULL;
