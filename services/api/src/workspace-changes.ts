import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Principal} from './auth.js';
export function registerWorkspaceChanges(app:FastifyInstance,db:PrismaClient,authenticate:(req:FastifyRequest)=>Promise<Principal>){
 app.get('/v1/changes',async(req,reply)=>{
  const p=await authenticate(req);
  const [state]=await db.$queryRaw<Array<{content:string;inbox:bigint;unread:number}>>`WITH active_grants AS MATERIALIZED (
   SELECT "courseId","programmeId","subjectId","planId" FROM "Enrollment" WHERE "userId"=${p.userId}::uuid AND "activeFrom"<=statement_timestamp() AND ("validUntil" IS NULL OR "validUntil">statement_timestamp())
  ), keys AS (SELECT unnest(ARRAY['content','user:'||${p.userId}]||ARRAY(SELECT DISTINCT 'course:'||"courseId" FROM active_grants)) id)
  SELECT (SELECT string_agg(k.id||':'||COALESCE(w.revision,0)::text,',' ORDER BY k.id) FROM keys k LEFT JOIN "WorkspaceRevision" w ON w.id=k.id)
   ||'/'||COALESCE((SELECT string_agg("courseId"||':'||"programmeId"||':'||"subjectId"||':'||"planId",',' ORDER BY "courseId","programmeId","subjectId","planId") FROM active_grants),'') content,
   COALESCE(i.revision,0) inbox,COALESCE(i."unreadCount",0) unread FROM (SELECT 1) base LEFT JOIN "InboxState" i ON i."userId"=${p.userId}::uuid`;
  const token=(value:bigint|string)=>createHash('sha256').update(`${p.userId}:${value}`).digest('base64url');
  reply.header('Cache-Control','private, no-store');
  return {contentVersion:token(state?.content??'content:0'),inboxVersion:token(state?.inbox??0n),unreadCount:state?.unread??0};
 });
}
