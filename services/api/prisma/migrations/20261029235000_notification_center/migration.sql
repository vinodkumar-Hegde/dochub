CREATE TABLE "Notification" (
 "id" UUID NOT NULL, "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "createdById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "eventKey" TEXT, "courseIds" TEXT[] NOT NULL, "programmeIds" TEXT[] NOT NULL, "planIds" TEXT[] NOT NULL,
 "subjectId" TEXT, "sourceId" UUID, PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");
CREATE INDEX "Notification_createdAt_id_idx" ON "Notification"("createdAt","id");
CREATE INDEX "Notification_createdById_createdAt_idx" ON "Notification"("createdById","createdAt");
CREATE TABLE "NotificationRecipient" (
 "notificationId" UUID NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "readAt" TIMESTAMP(3), PRIMARY KEY ("notificationId","userId")
);
CREATE INDEX "NotificationRecipient_userId_readAt_notificationId_idx" ON "NotificationRecipient"("userId","readAt","notificationId");
CREATE TABLE "NotificationAttachment" (
 "id" UUID NOT NULL, "notificationId" UUID NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "data" BYTEA NOT NULL, PRIMARY KEY ("id")
);
CREATE INDEX "NotificationAttachment_notificationId_idx" ON "NotificationAttachment"("notificationId");
