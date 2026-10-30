import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {AuthError} from './auth.js';
export const analyticsQuery=z.object({courseId:z.string().uuid().optional(),programmeId:z.string().uuid().optional(),planId:z.string().uuid().optional(),status:z.enum(['ALL','ACTIVE','EXPIRED','SCHEDULED','LOCKED']).default('ALL'),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),inactivePage:z.coerce.number().int().min(1).max(10000).default(1),materialsPage:z.coerce.number().int().min(1).max(10000).default(1)});
/** Aggregate in PostgreSQL; never hydrate the entire student/session/view graph in Node. */
export async function readAnalytics(db:PrismaClient,q:z.infer<typeof analyticsQuery>){
 const now=new Date(),from=q.from?new Date(`${q.from}T00:00:00+05:30`):new Date(+now-30*86400000),to=q.to?new Date(`${q.to}T23:59:59.999+05:30`):now;
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||from>to)throw new AuthError(422,'Choose a valid date range');
 const scope=Prisma.sql`(${q.courseId??null}::text IS NULL OR e."courseId"=${q.courseId??null}) AND (${q.programmeId??null}::text IS NULL OR e."programmeId"=${q.programmeId??null}) AND (${q.planId??null}::text IS NULL OR e."planId"=${q.planId??null})`;
 const rows=await db.$queryRaw<Array<{data:Record<string,unknown>}>>(Prisma.sql`
 WITH grants AS MATERIALIZED (SELECT e.* FROM "Enrollment" e WHERE ${scope}),
 flags AS (SELECT u.id,u."displayName",u.email,
  CASE WHEN NOT u.enabled THEN 'LOCKED'
   WHEN EXISTS(SELECT 1 FROM grants g WHERE g."userId"=u.id AND g."activeFrom"<=${now} AND (g."validUntil" IS NULL OR g."validUntil">${now})) THEN 'ACTIVE'
   WHEN EXISTS(SELECT 1 FROM grants g WHERE g."userId"=u.id AND g."activeFrom">${now}) THEN 'SCHEDULED' ELSE 'EXPIRED' END status
  FROM "User" u WHERE EXISTS(SELECT 1 FROM "UserProfile" r WHERE r."userId"=u.id AND r.role='STUDENT')
  AND (${!q.courseId&&!q.programmeId&&!q.planId} OR EXISTS(SELECT 1 FROM grants g WHERE g."userId"=u.id))),
 students AS MATERIALIZED (SELECT * FROM flags WHERE ${q.status}='ALL' OR status=${q.status}),
 recent_views AS MATERIALIZED (SELECT "userId","documentId","lastOpenedAt" FROM "MaterialView" WHERE "lastOpenedAt" BETWEEN ${from} AND ${to}),
 recent_events AS MATERIALIZED (SELECT "actorId","targetId",action,"createdAt" FROM "AuditEvent" WHERE "createdAt" BETWEEN ${from} AND ${to} AND "actorId" IS NOT NULL),
 activity AS MATERIALIZED (SELECT id,MAX(seen) seen,BOOL_OR(engaged) engaged FROM (
  SELECT "userId" id,MAX("lastSeenAt") seen,BOOL_OR("lastSeenAt" BETWEEN ${from} AND ${to}) engaged FROM "AppSession" GROUP BY "userId"
  UNION ALL SELECT "userId",MAX("lastOpenedAt"),true FROM recent_views GROUP BY "userId"
  UNION ALL SELECT "actorId",MAX("createdAt"),true FROM recent_events GROUP BY "actorId") a GROUP BY id),
 inactive AS MATERIALIZED (SELECT s.*,a.seen FROM students s LEFT JOIN activity a ON a.id=s.id WHERE NOT COALESCE(a.engaged,false)),
 docs AS MATERIALIZED (SELECT d.* FROM "Document" d WHERE d.state='PUBLISHED'
  AND (${q.courseId??null}::text IS NULL OR d."courseId"=${q.courseId??null}) AND (${q.programmeId??null}::text IS NULL OR d."programmeId"=${q.programmeId??null})
  AND (${q.planId??null}::text IS NULL OR EXISTS(SELECT 1 FROM "DocumentPlan" dp WHERE dp."documentId"=d.id AND dp."planId"=${q.planId??null}))),
 page_docs AS MATERIALIZED (SELECT * FROM docs ORDER BY "createdAt" DESC,id LIMIT 50 OFFSET ${(q.materialsPage-1)*50}),
 doc_scopes AS MATERIALIZED (SELECT d.id,d."courseId",d."programmeId",d."subjectId",COALESCE(array_agg(dp."planId" ORDER BY dp."planId") FILTER(WHERE dp."planId" IS NOT NULL),ARRAY[]::text[]) plans FROM page_docs d LEFT JOIN "DocumentPlan" dp ON dp."documentId"=d.id GROUP BY d.id,d."courseId",d."programmeId",d."subjectId"),
 permission_groups AS (SELECT DISTINCT "courseId","programmeId","subjectId",plans FROM doc_scopes),
 eligible_grants AS MATERIALIZED (SELECT g.* FROM grants g JOIN students s ON s.id=g."userId"),
 audiences AS (SELECT p."courseId",p."programmeId",p."subjectId",p.plans,COUNT(DISTINCT g."userId")::int total FROM permission_groups p LEFT JOIN eligible_grants g ON g."courseId"=p."courseId" AND g."programmeId"=p."programmeId" AND g."subjectId"=p."subjectId" AND g."planId"=ANY(p.plans) GROUP BY p."courseId",p."programmeId",p."subjectId",p.plans),
 opened AS (SELECT "documentId" doc,"userId" FROM recent_views UNION SELECT "targetId","actorId" FROM recent_events WHERE action IN ('DOCUMENT_PREVIEW_AUTHORIZED','DOCUMENT_READ_AUTHORIZED')),
 open_counts AS (SELECT d.id,COUNT(DISTINCT o."userId")::int total FROM doc_scopes d JOIN opened o ON o.doc=d.id JOIN eligible_grants g ON g."userId"=o."userId" AND g."courseId"=d."courseId" AND g."programmeId"=d."programmeId" AND g."subjectId"=d."subjectId" AND g."planId"=ANY(d.plans) GROUP BY d.id),
 sessions AS MATERIALIZED (SELECT s.* FROM "LiveSession" s WHERE s."publishedAt" IS NOT NULL
  AND (${q.courseId??null}::text IS NULL OR s."courseId"::text=${q.courseId??null}) AND (${q.programmeId??null}::text IS NULL OR s."programmeId"::text=${q.programmeId??null})
  AND (${q.planId??null}::text IS NULL OR EXISTS(SELECT 1 FROM "LiveSessionPlan" sp WHERE sp."sessionId"=s.id AND sp."planId"::text=${q.planId??null}))
  AND (${!q.from&&!q.to} OR s."startAt" BETWEEN ${from} AND ${to}))
 SELECT jsonb_build_object(
 'students',(SELECT COUNT(*)::int FROM students),
 'engaged',(SELECT COUNT(*)::int FROM students s JOIN activity a ON a.id=s.id WHERE a.engaged),
 'inactiveCount',(SELECT COUNT(*)::int FROM inactive),
 'inactive',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',"displayName",'email',email,'status',status,'lastSeen',to_char(seen,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) FROM (SELECT * FROM inactive ORDER BY id LIMIT 50 OFFSET ${(q.inactivePage-1)*50}) x),'[]'),
 'inactiveNextPage',CASE WHEN (SELECT COUNT(*) FROM inactive)>${q.inactivePage*50} THEN ${q.inactivePage+1} ELSE NULL END,
 'byCourse',COALESCE((SELECT jsonb_agg(x) FROM (SELECT c.id,c.name,COUNT(DISTINCT g."userId")::int count FROM "AcademicCourse" c JOIN eligible_grants g ON c.id::text=g."courseId" GROUP BY c.id ORDER BY c.name,c.id) x),'[]'),
 'byPlan',COALESCE((SELECT jsonb_agg(x) FROM (SELECT p.id,p.name,COUNT(DISTINCT g."userId")::int count FROM "AcademicPlan" p JOIN eligible_grants g ON p.id::text=g."planId" GROUP BY p.id ORDER BY p.name,p.id) x),'[]'),
 'materials',COALESCE((SELECT jsonb_agg(x ORDER BY x.title,x.id) FROM (SELECT d.id,d.title,COALESCE(p.name,'Programme') programme,COALESCE(o.total,0) opened,a.total-COALESCE(o.total,0) "notOpened" FROM page_docs d JOIN doc_scopes ds ON ds.id=d.id JOIN audiences a ON a."courseId"=ds."courseId" AND a."programmeId"=ds."programmeId" AND a."subjectId"=ds."subjectId" AND a.plans=ds.plans LEFT JOIN open_counts o ON o.id=d.id LEFT JOIN "AcademicProgramme" p ON p.id::text=d."programmeId") x),'[]'),
 'materialsCount',(SELECT COUNT(*)::int FROM docs),
 'materialsNextPage',CASE WHEN (SELECT COUNT(*) FROM docs)>${q.materialsPage*50} THEN ${q.materialsPage+1} ELSE NULL END,
 'sessions',(SELECT COUNT(*)::int FROM sessions),
 'byProgramme',COALESCE((SELECT jsonb_agg(x) FROM (SELECT p.id,p.name,(SELECT COUNT(*)::int FROM docs d WHERE d."programmeId"=p.id::text) pdfs,(SELECT COUNT(*)::int FROM sessions s WHERE s."programmeId"::text=p.id::text) sessions FROM "AcademicProgramme" p WHERE (${q.courseId??null}::text IS NULL OR p."courseId"::text=${q.courseId??null}) AND (${q.programmeId??null}::text IS NULL OR p.id::text=${q.programmeId??null}) ORDER BY p.name,p.id) x),'[]'),
 'courseCoverage',COALESCE((SELECT jsonb_agg(x) FROM (SELECT c.id,c.name,(SELECT COUNT(*)::int FROM docs d WHERE d."courseId"=c.id::text) pdfs,(SELECT COUNT(*)::int FROM sessions s WHERE s."courseId"::text=c.id::text) sessions FROM "AcademicCourse" c WHERE (${q.courseId??null}::text IS NULL OR c.id::text=${q.courseId??null}) ORDER BY c.name,c.id) x),'[]')
 ) data`);
 return {...rows[0]!.data,period:{from:from.toISOString(),to:to.toISOString()}};
}
