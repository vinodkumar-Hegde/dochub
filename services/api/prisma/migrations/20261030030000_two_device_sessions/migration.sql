ALTER TABLE "AppSession" ADD COLUMN "deviceHash" TEXT;
CREATE INDEX "AppSession_userId_deviceHash_idx" ON "AppSession"("userId","deviceHash");
WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt", id) AS device_number
 FROM "AppSession" WHERE "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP AND "lastSeenAt">CURRENT_TIMESTAMP-INTERVAL '30 minutes'
) UPDATE "AppSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE id IN (SELECT id FROM ranked WHERE device_number>2);
