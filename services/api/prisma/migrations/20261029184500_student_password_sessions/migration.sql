-- Additive student-only credentials, sessions, one-use email links and shared rate limits.
-- The existing User/Enrollment identities and Cognito admin integration are unchanged.
CREATE TABLE "StudentCredential" (
  "userId" UUID NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "passwordUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCredential_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "StudentSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "credentialRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "StudentSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudentAuthToken" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "StudentAuthToken_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StudentAuthThrottle" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentAuthThrottle_pkey" PRIMARY KEY ("key")
);
CREATE UNIQUE INDEX "StudentSession_tokenHash_key" ON "StudentSession"("tokenHash");
CREATE INDEX "StudentSession_userId_revokedAt_expiresAt_idx" ON "StudentSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "StudentSession_expiresAt_idx" ON "StudentSession"("expiresAt");
CREATE UNIQUE INDEX "StudentAuthToken_tokenHash_key" ON "StudentAuthToken"("tokenHash");
CREATE INDEX "StudentAuthToken_userId_purpose_usedAt_expiresAt_idx" ON "StudentAuthToken"("userId", "purpose", "usedAt", "expiresAt");
CREATE INDEX "StudentAuthThrottle_expiresAt_idx" ON "StudentAuthThrottle"("expiresAt");
ALTER TABLE "StudentCredential" ADD CONSTRAINT "StudentCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentSession" ADD CONSTRAINT "StudentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentAuthToken" ADD CONSTRAINT "StudentAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fast case-insensitive subscriber lookup without asserting an unsafe unique constraint.
CREATE INDEX IF NOT EXISTS "User_email_lower_idx" ON "User" (lower("email"));
