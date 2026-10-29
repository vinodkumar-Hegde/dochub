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
  replaceExisting:z.boolean().default(false),
  rows:z.array(z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),phone:z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),course:z.string().trim().max(120).optional(),activationDate:z.string().refine(validImportDate,'Activation Date must be YYYY-MM-DD').optional(),expiryDate:z.string().refine(validImportDate,'Expiry Date must be YYYY-MM-DD').optional()}).strict()).min(1).max(200),
}).strict();
const createStudentInput = z.object({
  email:z.string().trim().email().max(254),
  phone:z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
  displayName:z.string().trim().min(2).max(120),
  grants:z.array(grant).min(1).max(500),
}).strict();
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
  id:user.id, email:user.email, phone:(user as typeof user & {phone?:string|null}).phone??null, displayName:user.displayName, enabled:user.enabled,
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

  /** Stores a student's subscriptions without creating a Cognito login.
   * Pending identity subjects cannot match Cognito-generated UUID sub claims
   * accepted from properly verified access tokens. Future activation must verify the student's
   * identity before atomically binding that sub to this same user record. */
  app.post('/v1/admin/subscribers', async (req,reply)=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const input=createStudentInput.parse(req.body);
    const email=normalizeSubscriberEmail(input.email);
    try {
      const result=await db.$transaction(async tx=>{
        await ensureApprovedGrants(tx,input.grants);
        // Serializable transaction protects the email lookup + creation from
        // concurrent Add Student requests, even before a unique email index exists.
        const matches=await tx.user.findMany({
          where:{email:{equals:email,mode:'insensitive'}},
          include:{roles:true},take:2,
        });
        const conflict=existingSubscriberConflict(matches);
        if(conflict) throw new AuthError(409,conflict);
        const existing=matches[0];
        const nameChanged=Boolean(existing && existing.displayName!==input.displayName);
        const user=existing
          ? await tx.user.update({where:{id:existing.id},data:{email,displayName:input.displayName,phone:input.phone??null}})
          : await tx.user.create({data:{identitySub:pendingIdentitySub(randomUUID()),email,displayName:input.displayName,phone:input.phone??null}});
        if(!existing) await tx.userProfile.create({data:{userId:user.id,role:'STUDENT'}});
        const added=await tx.enrollment.createMany({
          data:input.grants.map(g=>({...g,userId:user.id,activeFrom:g.activeFrom?new Date(g.activeFrom):new Date(),validUntil:g.validUntil?new Date(g.validUntil):null})),
          skipDuplicates:true,
        });
        if(!existing || added.count>0 || nameChanged) {
          await tx.user.update({where:{id:user.id},data:{revision:{increment:1}}});
          await tx.auditEvent.create({data:{actorId:principal.userId,targetId:user.id,
            action:'SUBSCRIBER_REGISTERED_LOGIN_PENDING',
            details:{newProfile:!existing,addedGrants:added.count,loginPaused:true}}});
        }
        return {id:user.id,newSubscriber:!existing,assigned:added.count,loginPending:true};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      return reply.code(result.newSubscriber?201:200).send(result);
    } catch(error) {
      if(error && typeof error==='object' && 'code' in error && ['P2002','P2034'].includes(String(error.code))) {
        throw new AuthError(409,'Concurrent subscriber update. Retry the same Add Student action.');
      }
      throw error;
    }
  });

  // CSV import does not create a login or bypass approval. A single request is atomic:
  // bad rows, conflicting identities, and concurrent updates reject the whole batch.
  app.post('/v1/admin/subscribers/import', async (req,reply)=>{
    const principal=await authenticate(req); assertRole(principal,['SUPER_ADMIN']);
    const input=bulkStudentInput.parse(req.body);
    const emails=input.rows.map(row=>normalizeSubscriberEmail(row.email));
    const windows=input.rows.map((row,index)=>{
      const window=resolveImportWindow(row,input.activeFrom,input.validUntil);
      if(!window)throw new AuthError(422,`CSV row ${index+2}: expiry must follow activation date`);
      return window;
    });
    if(new Set(emails).size!==emails.length) throw new AuthError(422,'CSV contains duplicate student emails');
    const grants=input.planIds.flatMap(planId=>input.subjectIds.map(subjectId=>({
      courseId:input.courseId,programmeId:input.programmeId,subjectId,planId,activeFrom:input.activeFrom,validUntil:input.validUntil,
    })));
    if(grants.length*emails.length>4000) throw new AuthError(413,'Too many access grants; import a smaller file');
    try {
      const counts=await db.$transaction(async tx=>{
        await ensureApprovedGrants(tx,grants);
        const course=await tx.academicCourse.findUnique({where:{id:input.courseId},select:{name:true,code:true}});
        if(!course) throw new AuthError(422,'Selected course no longer exists');
        if(input.rows.some(row=>row.course &&
            ![course.name.toLowerCase(),course.code.toLowerCase()].includes(row.course.trim().toLowerCase())))
          throw new AuthError(422,'CSV course must match the selected course on every row');
        const existing=await tx.user.findMany({where:{email:{in:emails,mode:'insensitive'}},include:{roles:true}});
        if(existing.length!==new Set(existing.map(u=>u.email?.toLowerCase())).size) throw new AuthError(409,'Duplicate existing email identities must be resolved first');
        const byEmail=new Map(existing.map(u=>[u.email!.toLowerCase(),u]));
        for(const user of existing){const conflict=existingSubscriberConflict([user]);if(conflict)throw new AuthError(409,conflict);}
        let created=0,updated=0,grantsAdded=0,grantsUpdated=0;
        const newAudits:Array<{actorId:string;targetId:string;action:string;details:Prisma.InputJsonValue}>=[];
        for(let i=0;i<input.rows.length;i++){
          const row=input.rows[i]!,email=emails[i]!;
          const old=byEmail.get(email);
          const user=old ? await tx.user.update({where:{id:old.id},data:{displayName:row.name,phone:row.phone??old.phone,revision:{increment:1}}})
            : await tx.user.create({data:{identitySub:pendingIdentitySub(randomUUID()),displayName:row.name,email,phone:row.phone??null,revision:1,roles:{create:{role:'STUDENT'}}}});
          if(old)updated++;else created++;
          const access=windows[i]!;
          // Explicit replacement revokes every prior course/programme for this
          // matched student inside the same serializable import transaction.
          const revoked=old&&input.replaceExisting
            ? (await tx.enrollment.deleteMany({where:{userId:user.id}})).count : 0;
          const changed=input.replaceExisting?{count:0}:await tx.enrollment.updateMany({where:{userId:user.id,courseId:input.courseId,programmeId:input.programmeId,subjectId:{in:input.subjectIds},planId:{in:input.planIds}},data:{activeFrom:access.activeFrom,validUntil:access.validUntil}});
          const added=await tx.enrollment.createMany({data:grants.map(g=>({userId:user.id,courseId:g.courseId,programmeId:g.programmeId,subjectId:g.subjectId,planId:g.planId,activeFrom:access.activeFrom,validUntil:access.validUntil})),skipDuplicates:true});
          grantsAdded+=added.count;grantsUpdated+=changed.count;
          newAudits.push({actorId:principal.userId,targetId:user.id,action:'SUBSCRIBER_CSV_IMPORTED',details:{created:!old,grantsAdded:added.count,datesUpdated:changed.count,replacedExisting:input.replaceExisting,grantsRevoked:revoked,activation:access.activeFrom.toISOString(),expiry:access.validUntil?.toISOString()??null,loginPending:true}});
        }
        await tx.auditEvent.createMany({data:newAudits});
        return {created,updated,grantsAdded,grantsUpdated,rows:input.rows.length};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60_000});
      return reply.code(200).send(counts);
    } catch(error){
      if(error && typeof error==='object' && 'code' in error && ['P2002','P2034'].includes(String(error.code)))
        throw new AuthError(409,'Concurrent subscriber import. Refresh and retry the same CSV.');
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
      if(users.length!==input.userIds.length) throw new AuthError(422,'All selected subscribers must be active student accounts');
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
