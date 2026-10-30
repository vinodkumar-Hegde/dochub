CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId","createdAt");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE TABLE "WorkspaceRevision" (id TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0);
INSERT INTO "WorkspaceRevision"(id) VALUES ('content');
CREATE TABLE "InboxState" (
 "userId" UUID PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL DEFAULT 0, "unreadCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "InboxState"("userId",revision,"unreadCount") SELECT "userId",count(*),count(*) FILTER(WHERE "readAt" IS NULL) FROM "NotificationRecipient" GROUP BY "userId";
CREATE TABLE "NotificationDeliveryJob" (
 "notificationId" UUID PRIMARY KEY REFERENCES "Notification"(id) ON DELETE CASCADE,
 cursor UUID, delivered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completedAt" TIMESTAMP(3),"lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NotificationDeliveryJob_completedAt_nextAttemptAt_idx" ON "NotificationDeliveryJob"("completedAt","nextAttemptAt");
CREATE FUNCTION dochub_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE "WorkspaceRevision" SET revision=revision+1 WHERE id='content'; RETURN NULL; END $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['Document','DocumentFolder','AcademicCourse','AcademicProgramme','AcademicPlan','AcademicSubject','AcademicFaculty','ProgrammePlan','ProgrammeSubject','Enrollment','LiveSession','LiveSessionPlan','UserProfile','ModulePermission'] LOOP
  EXECUTE format('CREATE TRIGGER dochub_content_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION dochub_content_changed()',t);
 END LOOP;
END $$;
CREATE FUNCTION dochub_inbox_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta INTEGER;
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE "InboxState" SET revision=revision+1,"unreadCount"=GREATEST(0,"unreadCount"-CASE WHEN OLD."readAt" IS NULL THEN 1 ELSE 0 END) WHERE "userId"=OLD."userId";
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW."readAt" IS NOT DISTINCT FROM OLD."readAt" THEN RETURN NEW; END IF;
 delta:=CASE WHEN NEW."readAt" IS NULL THEN 1 ELSE 0 END;
 IF TG_OP='UPDATE' THEN delta:=delta-CASE WHEN OLD."readAt" IS NULL THEN 1 ELSE 0 END; END IF;
 INSERT INTO "InboxState"("userId",revision,"unreadCount") VALUES(NEW."userId",1,GREATEST(0,delta))
 ON CONFLICT ("userId") DO UPDATE SET revision="InboxState".revision+1,"unreadCount"=GREATEST(0,"InboxState"."unreadCount"+delta);
 RETURN NEW;
END $$;
CREATE TRIGGER dochub_inbox_revision AFTER INSERT OR UPDATE OR DELETE ON "NotificationRecipient" FOR EACH ROW EXECUTE FUNCTION dochub_inbox_changed();
