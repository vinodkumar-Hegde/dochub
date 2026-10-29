import {publishNotification} from './notification-delivery.js';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertRole, AuthError, type Principal } from './auth.js';
import { pastSessionIsReadOnly,canStudentSeeSession, sessionDateFilter, validSessionMapping, youtubeLinkValid } from './sessions-policy.js';
import { resolveProgrammeSelection } from './programme-targets.js';
import { isTaxonomyAvailable } from './academic-lifecycle-policy.js';
import { attendanceMutationDecision, canSubmitStudentResponse } from './student-attendance-policy.js';

const uuid=z.string().uuid();
const status=z.enum(['DRAFT','SCHEDULED','POSTPONED','CANCELLED','COMPLETED']);
const platform=z.enum(['DOCTUTORIALS_APP','YOUTUBE','ZOOM','DTLC']);
const fields=z.object({
  courseId:uuid.optional(),programmeId:uuid,subjectId:uuid,mappingRevision:z.number().int().nonnegative().optional(),topic:z.string().trim().min(2).max(240),facultyName:z.string().trim().min(2).max(160),facultyId:uuid,
  startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true}),platform,
  youtubeUrl:z.string().trim().url().nullable(),remarks:z.string().trim().max(2000).nullable(),planIds:z.array(uuid).min(1).max(100).optional(),status,
}).strict();
const update=fields.extend({revision:z.number().int().nonnegative()});
const listQuery=z.object({courseId:uuid.optional(),programmeId:uuid.optional(),tab:z.enum(['Today','Upcoming','Completed','Scheduled','All']).default('All'),q:z.string().trim().max(120).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(50)});
const action=z.object({revision:z.number().int().nonnegative(),publish:z.boolean()}).strict();
const idParam=z.object({id:uuid});
const scope={plans:{select:{planId:true}}} as const;
const attendanceInput=z.object({response:z.enum(['WILL_ATTEND','NOT_AVAILABLE','WATCH_RECORDING'])}).strict();
type ScopeDb=Pick<Prisma.TransactionClient,'enrollment'|'academicProgramme'|'academicCourse'|'academicSubject'|'academicPlan'|'academicFaculty'>;

async function studentSessionScope(db:ScopeDb,userId:string,now:Date){
  const grants=await db.enrollment.findMany({where:{userId,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}});
  if(!grants.length)return {permitted:[],scoped:[],liveFaculty:new Set<string>(),programmeById:new Map<string,never>(),subjectById:new Map<string,string>()};
  const permitted=await db.academicProgramme.findMany({where:{id:{in:grants.map(g=>g.programmeId)},locked:true,hidden:false,accessLocked:false,archivedAt:null,course:{hidden:false,accessLocked:false,archivedAt:null}},include:{plans:{select:{planId:true}},subjects:{select:{subjectId:true}}}});
  const [courses,subjects,plans,faculties]=await Promise.all([
    db.academicCourse.findMany({where:{id:{in:grants.map(g=>g.courseId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true}}),
    db.academicSubject.findMany({where:{id:{in:grants.map(g=>g.subjectId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true,name:true}}),
    db.academicPlan.findMany({where:{id:{in:grants.map(g=>g.planId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true}}),
    db.academicFaculty.findMany({where:{hidden:false,accessLocked:false,archivedAt:null},select:{id:true}}),
  ]);
  const allowed=new Set(permitted.map(p=>p.id));
  const liveCourses=new Set(courses.map(x=>x.id)),liveSubjects=new Set(subjects.map(x=>x.id)),livePlans=new Set(plans.map(x=>x.id));
  return {permitted,scoped:grants.filter(g=>allowed.has(g.programmeId)&&liveCourses.has(g.courseId)&&liveSubjects.has(g.subjectId)&&livePlans.has(g.planId)),liveFaculty:new Set(faculties.map(x=>x.id)),programmeById:new Map(permitted.map(p=>[p.id,p])),subjectById:new Map(subjects.map(x=>[x.id,x.name]))};
}

function isStudentSessionEligible(s:{courseId:string;programmeId:string;subjectId:string;facultyId:string|null;publishedAt:Date|null;status:import('./sessions-policy.js').SessionStatus;plans:{planId:string}[]},access:Awaited<ReturnType<typeof studentSessionScope>>,now:Date){
  const planIds=s.plans.map(p=>p.planId);
  return (!s.facultyId||access.liveFaculty.has(s.facultyId)) &&
    canStudentSeeSession({...s,planIds},access.scoped,now) &&
    validSessionMapping(access.programmeById.get(s.programmeId)??null,{courseId:s.courseId,programmeId:s.programmeId,subjectId:s.subjectId,planIds});
}


async function validateSession(tx:Prisma.TransactionClient,input:z.infer<typeof fields>){
  if(new Date(input.endAt)<=new Date(input.startAt))throw new AuthError(422,'End time must be after start time');
  if(!youtubeLinkValid(input.platform,input.youtubeUrl))throw new AuthError(422,'Provide a valid HTTPS YouTube link only for YouTube sessions');
  const f=await tx.academicFaculty.findUnique({where:{id:input.facultyId}});
  if(!isTaxonomyAvailable(f))throw new AuthError(423,'Faculty is hidden, locked or archived');
  if(f!.name!==input.facultyName)throw new AuthError(409,'Faculty name changed; refresh the selection');
  return resolveProgrammeSelection(tx,input);
}
function serial(s:{plans:{planId:string}[];[key:string]:unknown}) {const {plans,...rest}=s;return {...rest,planIds:plans.map(p=>p.planId)};}
export function registerSessions(app:FastifyInstance,db:PrismaClient,authenticate:(req:FastifyRequest)=>Promise<Principal>):void {
  app.get('/v1/admin/sessions/summary',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const [total,published]=await Promise.all([db.liveSession.count(),db.liveSession.count({where:{publishedAt:{not:null}}})]);
    return {total,published};
  });
  app.get('/v1/admin/sessions',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const input=listQuery.parse(req.query),filter=sessionDateFilter(input.tab);
    const rows=await db.liveSession.findMany({where:{...filter,...(input.courseId?{courseId:input.courseId}:{}),...(input.programmeId?{programmeId:input.programmeId}:{}),...(input.q?{OR:[{topic:{contains:input.q,mode:'insensitive'}},{facultyName:{contains:input.q,mode:'insensitive'}}]}:{})},include:scope,orderBy:[{startAt:'desc'},{id:'desc'}],take:input.limit});
    return {items:rows.map(serial)};
  });
  app.post('/v1/admin/sessions',async(req,reply)=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const input=fields.parse(req.body);
    const row=await db.$transaction(async tx=>{
      const targets=await validateSession(tx,input);
      const {planIds:_planIds,mappingRevision:_mappingRevision,courseId:_courseId,startAt,endAt,...rest}=input;
      const s=await tx.liveSession.create({data:{...rest,courseId:targets.courseId,startAt:new Date(startAt),endAt:new Date(endAt),publishedAt:null,createdById:principal.userId,updatedById:principal.userId,plans:{create:targets.planIds.map(planId=>({planId}))}}});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:s.id,action:'SESSION_CREATED',details:{status:s.status,planIds:targets.planIds,mappingRevision:targets.mappingRevision}}});
      return s;
    });
    return reply.code(201).send({id:row.id});
  });
  app.put('/v1/admin/sessions/:id',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const {id}=idParam.parse(req.params),input=update.parse(req.body);
    return db.$transaction(async tx=>{
      const old=await tx.liveSession.findUnique({where:{id}});
      if(!old)throw new AuthError(404,'Session not found');
      if(pastSessionIsReadOnly(principal.roles,old.endAt,old.status)||pastSessionIsReadOnly(principal.roles,new Date(input.endAt),input.status))throw new AuthError(403,'Only an administrator can change a session that has ended.');
      if(old.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Another manager owns this session');
      const targets=await validateSession(tx,input);
      const {revision,planIds:_planIds,mappingRevision:_mappingRevision,courseId:_courseId,startAt,endAt,...rest}=input;
      const result=await tx.liveSession.updateMany({where:{id,revision},data:{...rest,courseId:targets.courseId,startAt:new Date(startAt),endAt:new Date(endAt),publishedAt:null,revision:{increment:1},updatedById:principal.userId}});
      if(!result.count)throw new AuthError(409,'Session changed elsewhere; reload before saving');
      await tx.liveSessionPlan.deleteMany({where:{sessionId:id}});
      await tx.liveSessionPlan.createMany({data:targets.planIds.map(planId=>({sessionId:id,planId}))});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'SESSION_UPDATED_UNPUBLISHED',details:{status:input.status,planIds:targets.planIds,mappingRevision:targets.mappingRevision}}});
      return {status:'saved'};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  });
  app.post('/v1/admin/sessions/:id/publication',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const {id}=idParam.parse(req.params),input=action.parse(req.body);
    return db.$transaction(async tx=>{
      const s=await tx.liveSession.findUnique({where:{id},include:{plans:true}});
      if(!s)throw new AuthError(404,'Session not found');
      if(pastSessionIsReadOnly(principal.roles,s.endAt,s.status))throw new AuthError(403,'Only an administrator can publish or unpublish a session that has ended.');
      if(s.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Another manager owns this session');
      if(input.publish){
        if(s.status==='DRAFT')throw new AuthError(409,'Select a scheduled, postponed, cancelled or completed status before publishing');
        if(!s.facultyId)throw new AuthError(409,'Select a faculty from the directory and save this session before publishing');
        await validateSession(tx,{courseId:s.courseId,programmeId:s.programmeId,subjectId:s.subjectId,topic:s.topic,facultyName:s.facultyName,startAt:s.startAt.toISOString(),endAt:s.endAt.toISOString(),platform:s.platform,youtubeUrl:s.youtubeUrl,remarks:s.remarks,facultyId:s.facultyId,planIds:s.plans.map(p=>p.planId),status:s.status});
      }
      const result=await tx.liveSession.updateMany({where:{id,revision:input.revision},data:{publishedAt:input.publish?new Date():null,updatedById:principal.userId,revision:{increment:1}}});
      if(!result.count)throw new AuthError(409,'Session changed elsewhere; reload');
      if(input.publish&&!s.publishedAt)await publishNotification(tx,{kind:'SESSION',title:`Session published: ${s.topic}`,body:`${s.topic}\nFaculty: ${s.facultyName}\nStarts: ${s.startAt.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST\nStatus: ${s.status}\nOpen My Schedule for details.`,createdById:principal.userId,eventKey:`session:${s.id}:${s.revision}`,sourceId:s.id,courseIds:[s.courseId],programmeIds:[s.programmeId],planIds:s.plans.map(p=>p.planId),subjectId:s.subjectId});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:input.publish?'SESSION_PUBLISHED':'SESSION_UNPUBLISHED',details:{status:s.status,plans:s.plans.map(p=>p.planId)}}});
      return {status:input.publish?'published':'unpublished'};
    });
  });
  // Query filtering and mutations share the same active subscription/mapping policy.
  app.get('/v1/student/sessions',async req=>{
    const principal=await authenticate(req);assertRole(principal,['STUDENT']);
    const input=listQuery.parse(req.query),now=new Date();
    const access=await studentSessionScope(db,principal.userId,now);
    if(!access.scoped.length)return {programmes:[],items:[],nextPage:null};
    const permittedOr=access.scoped.map(g=>({courseId:g.courseId,programmeId:g.programmeId,subjectId:g.subjectId,plans:{some:{planId:g.planId}}}));
    const rows=await db.liveSession.findMany({where:{publishedAt:{not:null},status:{not:'DRAFT'},...sessionDateFilter(input.tab),OR:permittedOr,...(input.programmeId?{programmeId:input.programmeId}:{})},include:{...scope,studentResponses:{where:{userId:principal.userId},select:{response:true,markedAt:true}}},orderBy:[{startAt:'asc'},{id:'asc'}],skip:(input.page-1)*input.limit,take:input.limit+1});
    const listed=rows.slice(0,input.limit).filter(s=>isStudentSessionEligible(s,access,now));
    return {programmes:access.permitted.map(p=>({id:p.id,name:p.name,courseId:p.courseId})),items:listed.map(s=>{
      const {studentResponses,...session}=s;
      return {...serial(session),programmeName:access.programmeById.get(s.programmeId)?.name??'',subjectName:access.subjectById.get(s.subjectId)??'',attendance:studentResponses[0]??null};
    }),nextPage:rows.length>input.limit?input.page+1:null};
  });
  // Insert once using the database composite primary key. No student edit endpoint exists.
  app.post('/v1/student/sessions/:id/attendance',async(req,reply)=>{
    const principal=await authenticate(req);assertRole(principal,['STUDENT']);
    const {id}=idParam.parse(req.params),input=attendanceInput.parse(req.body),now=new Date();
    // All access checks are inside the same transaction as the insert/audit record.
    try {
      const created=await db.$transaction(async tx=>{
        const access=await studentSessionScope(tx,principal.userId,now);
        if(!access.scoped.length)throw new AuthError(404,'Session unavailable');
        const session=await tx.liveSession.findUnique({where:{id},include:scope});
        if(!session||!isStudentSessionEligible(session,access,now))throw new AuthError(404,'Session unavailable');
        const previous=await tx.studentSessionResponse.findUnique({where:{userId_sessionId:{userId:principal.userId,sessionId:id}}});
        const decision=attendanceMutationDecision(previous?.response??null,input.response);
        if(decision==='same')return {record:previous!,created:false};
        if(decision==='conflict')throw new AuthError(409,'Attendance response is already submitted and cannot be changed');
        if(!canSubmitStudentResponse(session.status,session.endAt,now))throw new AuthError(409,'This session has ended or is unavailable. Responses are read-only.');
        const record=await tx.studentSessionResponse.create({data:{userId:principal.userId,sessionId:id,response:input.response}});
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'STUDENT_SESSION_RESPONSE_SUBMITTED',details:{response:record.response}}});
        return {record,created:true};
      });
      return reply.code(created.created?201:200).send({response:created.record.response,markedAt:created.record.markedAt,locked:true});
    }catch(error){
      // Resolve concurrent identical submissions idempotently; differing answers remain locked.
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
        const access=await studentSessionScope(db,principal.userId,new Date());
        const session=await db.liveSession.findUnique({where:{id},include:scope});
        if(!session||!isStudentSessionEligible(session,access,new Date()))throw new AuthError(404,'Session unavailable');
        const previous=await db.studentSessionResponse.findUnique({where:{userId_sessionId:{userId:principal.userId,sessionId:id}}});
        if(previous?.response===input.response)return reply.code(200).send({response:previous.response,markedAt:previous.markedAt,locked:true});
        throw new AuthError(409,'Attendance response is already submitted and cannot be changed');
      }
      throw error;
    }
  });
}
