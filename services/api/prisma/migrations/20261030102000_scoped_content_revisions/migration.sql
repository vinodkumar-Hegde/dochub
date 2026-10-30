-- High-volume content changes invalidate only the affected course/user.
CREATE FUNCTION dochub_scoped_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE keys TEXT[]; prefix TEXT; scope_id TEXT; before_row JSONB; after_row JSONB;
BEGIN
 before_row:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_row:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME IN ('Enrollment','UserProfile','ModulePermission') THEN
  prefix:='user:';keys:=ARRAY[before_row->>'userId',after_row->>'userId'];
 ELSIF TG_TABLE_NAME='LiveSessionPlan' THEN
  prefix:='course:';
  SELECT array_agg("courseId"::text) INTO keys FROM "LiveSession" WHERE id=ANY(ARRAY[before_row->>'sessionId',after_row->>'sessionId']::uuid[]);
 ELSE prefix:='course:';keys:=ARRAY[before_row->>'courseId',after_row->>'courseId'];
 END IF;
 FOR scope_id IN SELECT DISTINCT unnest(keys) LOOP
  IF scope_id IS NOT NULL THEN
   INSERT INTO "WorkspaceRevision"(id,revision) VALUES(prefix||scope_id,1) ON CONFLICT(id) DO UPDATE SET revision="WorkspaceRevision".revision+1;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['Document','DocumentFolder','Enrollment','LiveSession','LiveSessionPlan','UserProfile','ModulePermission'] LOOP
  EXECUTE format('DROP TRIGGER dochub_content_revision ON %I',t);
  EXECUTE format('CREATE TRIGGER dochub_content_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dochub_scoped_content_changed()',t);
 END LOOP;
END $$;
