CREATE TABLE "LoginChallenge" (
 "id" UUID NOT NULL PRIMARY KEY, "userId" UUID, "email" TEXT NOT NULL, "codeHash" TEXT NOT NULL, "salt" TEXT NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoginChallenge_email_createdAt_idx" ON "LoginChallenge"("email","createdAt");
CREATE INDEX "LoginChallenge_expiresAt_idx" ON "LoginChallenge"("expiresAt");
CREATE TABLE "AppSession" (
 "id" UUID NOT NULL PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "email" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "AppSession_userId_revokedAt_idx" ON "AppSession"("userId","revokedAt");
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");
