import {isSubscriberPhone} from './subscriber-phone.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, assertRole, type Principal } from './auth.js';
import { validateGrants, type GrantSelection } from './subscriber-policy.js';
import type { Config } from './config.js';
import { normalizeSubscriberEmail } from './subscriber-email.js';
import { subscriberState, validSubscriptionWindow } from './academic-lifecycle-policy.js';
import { resolveImportWindow, validImportDate } from './subscriber-import-window.js';
import {subscriberImportIssues,type SubscriberImportIssue} from './subscriber-import-policy.js';
import { pendingIdentitySub, existingSubscriberConflict } from './pending-subscriber-policy.js';

const uuid = z.string().uuid();
const grant = z.object({
  courseId: uuid, programmeId: uuid, subjectId: uuid, planId: uuid,
  activeFrom: z.string().datetime({offset:true}).optional(),
  validUntil: z.string().datetime({offset:true}).nullable(),
}).strict();
const grantInput = z.object({ revision:z.number().int().nonnegative(), grants:z.array(grant).max(500) }).strict();
const userParam = z.object({id:uuid});
const pageQuery = z.object({cursor:uuid.optional(),limit:z.coerce.number().int().min(1).max(100).default(25),q:z.string().trim().max(120).optional(),courseId:uuid.optional(),planId:uuid.optional()});
const bulkStudentInput = z.object({
  courseId:uuid, programmeId:uuid, subjectIds:z.array(uuid).min(1).max(50),
  planIds:z.array(uuid).min(1).max(50),
  activeFrom:z.string().datetime({offset:true}).optional(),
  validUntil:z.string().datetime({offset:true}).nullable(),
  replaceExisting:z.literal(false).optional(),
  rows:z.array(z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),phone:z.string().trim().transform(value=>value||undefined).pipe(z.string().refine(isSubscriberPhone,'Enter a valid national or international phone number').optional()).optional(),course:z.string().trim().max(120).optional(),activationDate:z.string().refine(validImportDate,'Activation Date must be YYYY-MM-DD').optional(),expiryDate:z.string().refine(validImportDate,'Expiry Date must be YYYY-MM-DD').optional()}).strict()).min(1).max(200),
}).strict();
type BulkStudentInput=z.infer<typeof bulkStudentInput>;
function parseImportInput(body:unknown):BulkStudentInput{
  if(body&&typeof body==='object'&&'replaceExisting' in body&&body.replaceExisting===true)throw new AuthError(422,'Bulk upload creates new students only. Edit existing student access from Subscribers.');
  const parsed=bulkStudentInput.safeParse(body);
  if(!parsed.success){
    const messages=parsed.error.issues.slice(0,8).map(issue=>{
      const [field,index,column]=issue.path;
      return field==='rows'&&typeof index==='number'?`CSV row ${index+2}${column?` (${String(column)})`:''}: ${issue.message}`:`${issue.path.join('.')||'Import'}: ${issue.message}`;
    });
    throw new AuthError(422,messages.join(' · '));
  }
  return parsed.data;
}
async function validateImport(tx:Prisma.TransactionClient,input:BulkStudentInput):Promise<{issues:SubscriberImportIssue[];grants:Array<GrantSelection & {activeFrom?:string}>}>{
  const grants=input.planIds.flatMap(planId=>input.subjectIds.map(subjectId=>({courseId:input.courseId,programmeId:input.programmeId,subjectId,planId,activeFrom:input.activeFrom,validUntil:input.validUntil})));
  if(grants.length*input.rows.length>4000)throw new AuthError(413,`Selected plans and subjects allow at most ${Math.floor(4000/grants.length)} students per file. Reduce the file or select fewer mappings.`);
  await ensureApprovedGrants(tx,grants);
  const course=await tx.academicCourse.findUnique({where:{id:input.courseId},select:{name:true,code:true}});
  if(!course)throw new AuthError(422,'Selected course no longer exists');
  const emails=[...new Set(input.rows.map(row=>normalizeSubscriberEmail(row.email)))];
  // Match the same normalized expression as the database unique index, including legacy whitespace.
  const existing=await tx.$queryRaw<Array<{email:string}>>`SELECT email FROM "User" WHERE lower(btrim(email)) IN (${Prisma.join(emails)})`;
  return {issues:subscriberImportIssues(input.rows,existing.map(user=>user.email),course,input.activeFrom,input.validUntil),grants};
}

const createStudentInput = z.object({
  email:z.string().trim().email().max(254),
  phone:z.string().trim().refine(isSubscriberPhone,'Enter a valid national or international phone number').optional(),
  displayName:z.string().trim().min(2).max(120),
  grants:z.array(grant).min(1).max(500),
}).strict();
const profileInput=z.object({
  revision:z.number().int().nonnegative(),
  displayName:z.string().trim().min(2).max(120).optional(),
  email:z.string().trim().email().max(254).transform(normalizeSubscriberEmail).optional(),
  phone:z.string().trim().refine(value=>!value||isSubscriberPhone(value),'Enter a valid phone number').optional(),
  featuresLocked:z.boolean().optional(),
}).strict().refine(value=>Object.keys(value).some(key=>key!=='revision'),'Select a profile change');
const revisionInput=z.object({revision:z.number().int().nonnegative()}).strict();
async function manageableStudent(tx:Prisma.TransactionClient,id:string,actorId:string){
  const user=await tx.user.findUnique({where:{id},include:{roles:true}});
  if(!user||!user.roles.some(role=>role.role==='STUDENT'))throw new AuthError(404,'Subscriber not found');
  if(id===actorId||user.roles.some(role=>role.role!=='STUDENT'))throw new AuthError(403,'Manage employee accounts separately');
  return user;
}
function profileConflict(error:unknown):never {
  if(error&&typeof error==='object'&&'code' in error){
    if(error.code==='P2002')throw new AuthError(409,'This email already belongs to another user.');
    if(error.code==='P2034')throw new AuthError(409,'Subscriber changed elsewhere. Reload before saving.');
  }
  throw error;
}
const batchInput = z.object({
  userIds:z.array(uuid).min(1).max(100), grants:z.array(grant).min(1).max(200),
}).strict();

const enrolled = { select: { courseId:true,programmeId:true,subjectId:true,planId:true,activeFrom:true,validUntil:true } } as const;
const listStudent = { roles:{ some: { role:'STUDENT' as const } } };
const serialized = (user: {
  id:string;email:string|null;phone?:string|null;displayName:string|null;identitySub:string;
  enabled:boolean;revision:number;enrollments:ReadonlyArray<{
    courseId:string;programmeId:string;subjectId:string;planId:string;activeFrom:Date;validUntil:Date|null;
  }>;
}) => ({
  id:user.id, email:user.email, phone:(user as typeof user & {phone?:string|null}).phone??null, displayName:user.displayName, enabled:user.enabled, featuresLocked:!user.enabled,
  revision:user.revision,
  status:subscriberState(user.enabled,user.enrollments,new Date()),
  grants:user.enrollments.map(g=>({...g,activeFrom:g.activeFrom.toISOString(),validUntil:g.validUntil?.toISOString()??null})),
});

async function ensureApprovedGrants(
  tx: Prisma.TransactionClient,
  grants: ReadonlyArray<GrantSelection & {activeFrom?:string}>,
): Promise<void> {
  for(const g of grants){
    const activeFrom=g.activeFrom?new Date(g.activeFrom):new Date();
    const validUntil=g.validUntil?new Date(g.validUntil):null;
    if(!validSubscriptionWindow(activeFrom,validUntil))throw new AuthError(422,'Expiry date must follow activation date');
  }
  const programmes = await tx.academicProgramme.findMany({
    where:{id:{in:[...new Set(grants.map(g=>g.programmeId))]}},
    include:{course:true,plans:{include:{plan:true}},subjects:{include:{subject:true}}},
  });
  if(programmes.some(p=>p.hidden||p.accessLocked||p.archivedAt||p.course.hidden||p.course.accessLocked||p.course.archivedAt
    ||p.plans.some(link=>link.plan.hidden||link.plan.accessLocked||link.plan.archivedAt)
    ||p.subjects.some(link=>link.subject.hidden||link.subject.accessLocked||link.subject.archivedAt)))
    throw new AuthError(423,'Academic record is hidden, locked or archived');
  const error = validateGrants(grants, programmes);
  if (error) throw new AuthError(422,error);
}

/** Admin-only subscription management. Student identities remain pending until
 * a separately verified authentication workflow links the account. */
export function registerSubscribers(
  app:FastifyInstance, db:PrismaClient, cfg:Config,
  authenticate:(req:FastifyRequest)=>Promise<Principal>,
):void {
  // Student sign-in is paused. All administrative requests remain authenticated.
  // Keep the existing API signature to avoid altering caller contracts.
  void cfg;

  app.get('/v1/admin/subscribers', async req=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const input=pageQuery.parse(req.query);
    const where:Prisma.UserWhereInput={...listStudent,
      ...(input.courseId || input.planId ? {enrollments:{some:{...(input.courseId?{courseId:input.courseId}:{}),...(input.planId?{planId:input.planId}:{})}}} : {}),
      ...(input.q ? {OR:[{email:{contains:input.q,mode:'insensitive'}},{displayName:{contains:input.q,mode:'insensitive'}}]} : {}),
    };
    const [users,total]=await Promise.all([
      db.user.findMany({where,orderBy:{id:'asc'},take:input.limit+1,
        ...(input.cursor?{cursor:{id:input.cursor},skip:1}:{}),
        include:{enrollments:enrolled},
      }),
      db.user.count({where}),
    ]);
    const hasMore=users.length>input.limit;
    const items=users.slice(0,input.limit);
    return {items:items.map(serialized),total,nextCursor:hasMore?(items.at(-1)?.id??null):null};
  });

  app.get('/v1/admin/subscribers/summary', async req=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const now=new Date();
    const [total,active,courseRows]=await Promise.all([
      db.user.count({where:listStudent}),
      db.user.count({where:{...listStudent,enabled:true,enrollments:{some:{activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}}}}),
      db.$queryRaw<Array<{courseId:string;subscribers:bigint}>>`
        SELECT e."courseId" AS "courseId", COUNT(DISTINCT e."userId") AS "subscribers"
        FROM "Enrollment" e
        JOIN "User" u ON u."id" = e."userId" AND u."enabled" = TRUE
        JOIN "UserProfile" r ON r."userId" = u."id" AND r."role" = 'STUDENT'
        WHERE e."activeFrom" <= ${now} AND (e."validUntil" IS NULL OR e."validUntil" > ${now})
        GROUP BY e."courseId"
      `,
    ]);
    return {total,active,byCourse:Object.fromEntries(courseRows.map(r=>[r.courseId,Number(r.subscribers)]))};
  });

  app.patch('/v1/admin/subscribers/:id',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN']);
    const {id}=userParam.parse(req.params),input=profileInput.parse(req.body);
    try{return await db.$transaction(async tx=>{
      const user=await manageableStudent(tx,id,principal.userId);
      const emailChanged=input.email!==undefined&&input.email!==normalizeSubscriberEmail(user.email??'');
      if(input.email!==undefined){
        const matches=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${input.email} AND id <> ${id}::uuid LIMIT 1`;
        if(matches.length)throw new AuthError(409,'This email already belongs to another user.');
      }
      const updated=await tx.user.updateMany({where:{id,revision:input.revision},data:{
        ...(input.displayName!==undefined?{displayName:input.displayName}:{}),
        ...(input.email!==undefined?{email:input.email}:{}),
        ...(input.phone!==undefined?{phone:input.phone||null}:{}),
        ...(input.featuresLocked!==undefined?{enabled:!input.featuresLocked}:{}),revision:{increment:1},
      }});
      if(updated.count!==1)throw new AuthError(409,'Subscriber changed elsewhere. Reload before saving.');
      if(emailChanged){
        await tx.appSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
        await tx.loginChallenge.deleteMany({where:{userId:id}});
        await tx.studentSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});
        await tx.studentAuthToken.deleteMany({where:{userId:id}});
      }
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'SUBSCRIBER_PROFILE_UPDATED',details:{fields:Object.keys(input).filter(key=>key!=='revision'),emailChanged,featuresLocked:input.featuresLocked??!user.enabled}}});
      return {status:'saved',revision:input.revision+1};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}catch(error){profileConflict(error);}
  });

  app.delete('/v1/admin/subscribers/:id',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN']);
    const {id}=userParam.parse(req.params),input=revisionInput.parse(req.body);
    try{await db.$transaction(async tx=>{
      await manageableStudent(tx,id,principal.userId);
      const claimed=await tx.user.updateMany({where:{id,revision:input.revision},data:{revision:{increment:1}}});
      if(claimed.count!==1)throw new AuthError(409,'Subscriber changed elsewhere. Reload before deleting.');
      await tx.loginChallenge.deleteMany({where:{userId:id}});
      await tx.studentSession.deleteMany({where:{userId:id}});
      await tx.studentAuthToken.deleteMany({where:{userId:id}});
      await tx.studentCredential.deleteMany({where:{userId:id}});
      await tx.documentStudyPage.deleteMany({where:{userId:id}});
      await tx.studentSessionResponse.deleteMany({where:{userId:id}});
      await tx.enrollment.deleteMany({where:{userId:id}});
      await tx.userProfile.deleteMany({where:{userId:id}});
      await tx.user.delete({where:{id}});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'SUBSCRIBER_DELETED',details:{deleted:true}}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}catch(error){profileConflict(error);}
    return {status:'deleted'};
  });

  /** Register student details and subscriptions for email OTP sign-in. */
  app.post('/v1/admin/subscribers', async (req,reply)=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const input=createStudentInput.parse(req.body);
    const email=normalizeSubscriberEmail(input.email);
    try {
      const result=await db.$transaction(async tx=>{
        await ensureApprovedGrants(tx,input.grants);
        // Serializable transaction protects the email lookup + creation from
        // concurrent Add Student requests, even before a unique email index exists.
        const matchingIds=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 2`;
        const matches=await tx.user.findMany({where:{id:{in:matchingIds.map(user=>user.id)}},include:{roles:true}});
        const conflict=existingSubscriberConflict(matches);
        if(conflict) throw new AuthError(409,conflict);
        const existing=matches[0];
        if(existing)throw new AuthError(409,'This email already exists. Edit the student from Subscribers instead.');
        const user=await tx.user.create({data:{identitySub:pendingIdentitySub(randomUUID()),email,displayName:input.displayName,phone:input.phone??null,revision:1,roles:{create:{role:'STUDENT'}}}});
        const added=await tx.enrollment.createMany({
          data:input.grants.map(g=>({...g,userId:user.id,activeFrom:g.activeFrom?new Date(g.activeFrom):new Date(),validUntil:g.validUntil?new Date(g.validUntil):null})),
          skipDuplicates:true,
        });
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:user.id,
          action:'SUBSCRIBER_REGISTERED_LOGIN_PENDING',
          details:{newProfile:true,addedGrants:added.count,loginPaused:true}}});
        return {id:user.id,newSubscriber:true,assigned:added.count};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      return reply.code(201).send(result);
    } catch(error) {
      if(error && typeof error==='object' && 'code' in error && ['P2002','P2034'].includes(String(error.code))) {
        throw new AuthError(409,'This email already exists or was registered concurrently. Refresh Subscribers before trying again.');
      }
      throw error;
    }
  });

  app.post('/v1/admin/subscribers/import/validate',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN']);
    const input=parseImportInput(req.body);
    const {issues}=await db.$transaction(tx=>validateImport(tx,input));
    return {valid:issues.length===0,rows:input.rows.length,issues};
  });

  // New students only. Every row and duplicate is rechecked at commit time;
  // one invalid/existing email rolls back the complete file without altering users.
  app.post('/v1/admin/subscribers/import',async(req,reply)=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN']);
    const input=parseImportInput(req.body);
    try{
      const counts=await db.$transaction(async tx=>{
        const {issues,grants}=await validateImport(tx,input);
        if(issues.length)throw new AuthError(409,`No students imported. ${issues.slice(0,8).map(issue=>`Row ${issue.row} (${issue.email}): ${issue.message}`).join(' · ')}${issues.length>8?` · ${issues.length-8} more issues. Validate the file to see all rows.`:''}`);
        const audits:Array<{actorId:string;targetId:string;action:string;details:Prisma.InputJsonValue}>=[];
        for(const row of input.rows){
          const access=resolveImportWindow(row,input.activeFrom,input.validUntil)!;
          const user=await tx.user.create({data:{identitySub:pendingIdentitySub(randomUUID()),displayName:row.name,email:normalizeSubscriberEmail(row.email),phone:row.phone??null,revision:1,roles:{create:{role:'STUDENT'}},enrollments:{create:grants.map(g=>({courseId:g.courseId,programmeId:g.programmeId,subjectId:g.subjectId,planId:g.planId,...access}))}}});
          audits.push({actorId:principal.userId,targetId:user.id,action:'SUBSCRIBER_CSV_IMPORTED',details:{created:true,grantsAdded:grants.length,activation:access.activeFrom.toISOString(),expiry:access.validUntil?.toISOString()??null}});
        }
        await tx.auditEvent.createMany({data:audits});
        return {created:input.rows.length,grantsAdded:input.rows.length*grants.length,rows:input.rows.length};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60_000});
      return reply.code(201).send(counts);
    }catch(error){
      if(error&&typeof error==='object'&&'code' in error&&['P2002','P2034'].includes(String(error.code)))throw new AuthError(409,'No students imported. Another upload or account change conflicted with this file. Validate it again to check for existing emails.');
      throw error;
    }
  });

  app.put('/v1/admin/subscribers/:id/enrollments', async req=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const {id}=userParam.parse(req.params),input=grantInput.parse(req.body);
    try { await db.$transaction(async tx=>{
      const user=await tx.user.findFirst({where:{id,roles:{some:{role:'STUDENT'}}}});
      if(!user) throw new AuthError(404,'Subscriber not found');
      await ensureApprovedGrants(tx,input.grants);
      const changed=await tx.user.updateMany({where:{id,revision:input.revision},data:{revision:{increment:1}}});
      if(changed.count!==1) throw new AuthError(409,'Subscriber changed elsewhere. Reload before saving.');
      await tx.enrollment.deleteMany({where:{userId:id}});
      if(input.grants.length) await tx.enrollment.createMany({data:input.grants.map(g=>({...g,userId:id,activeFrom:g.activeFrom?new Date(g.activeFrom):new Date(),validUntil:g.validUntil?new Date(g.validUntil):null}))});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,
        action:'SUBSCRIBER_ENTITLEMENTS_REPLACED',details:{count:input.grants.length,revision:input.revision+1}}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}); }
    catch(error) { if(error && typeof error==='object' && 'code' in error && error.code==='P2034') throw new AuthError(409,'Concurrent update. Reload before saving.'); throw error; }
    return {status:'saved'};
  });

  // Bulk grants are additive; other programmes and subscriptions are preserved.
  app.post('/v1/admin/subscribers/bulk-assign', async req=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const input=batchInput.parse(req.body);
    if(new Set(input.userIds).size!==input.userIds.length) throw new AuthError(400,'Duplicate subscriber IDs');
    if(input.userIds.length*input.grants.length>2500) throw new AuthError(413,'Limit each bulk operation to 2500 access grants');
    try { await db.$transaction(async tx=>{
      await ensureApprovedGrants(tx,input.grants);
      const users=await tx.user.findMany({where:{id:{in:input.userIds},enabled:true,roles:{some:{role:'STUDENT'}}},select:{id:true}});
      if(users.length!==input.userIds.length) throw new AuthError(422,'All selected subscribers must have unlocked student features');
      for(const id of input.userIds) {
        await tx.enrollment.createMany({data:input.grants.map(g=>({userId:id,...g,activeFrom:g.activeFrom?new Date(g.activeFrom):new Date(),validUntil:g.validUntil?new Date(g.validUntil):null})),skipDuplicates:true});
        await tx.user.update({where:{id},data:{revision:{increment:1}}});
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,
          action:'SUBSCRIBER_BULK_GRANTS_ADDED',details:{count:input.grants.length}}});
      }
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20_000}); }
    catch(error) { if(error && typeof error==='object' && 'code' in error && error.code==='P2034') throw new AuthError(409,'Concurrent update. Retry after refreshing subscribers.'); throw error; }
    return {status:'saved',updated:input.userIds.length};
  });
}
