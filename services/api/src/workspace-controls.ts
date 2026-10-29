import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {AuthError,assertRole,type Principal} from './auth.js';
import {subscriberState} from './academic-lifecycle-policy.js';
import {normalizeSubscriberEmail} from './subscriber-email.js';
export const modules=['Analytics','Academic Mapping','Uploads','Sessions','Subscribers','Notifications','Watermark'] as const;
const permission=z.object({module:z.enum(modules),canView:z.boolean(),canManage:z.boolean()}).strict().refine(p=>!p.canManage||p.canView,'Manage requires View');
const employee=z.object({id:z.string().uuid().optional(),revision:z.number().int().nonnegative().default(0),displayName:z.string().trim().min(2).max(120),email:z.string().trim().email().transform(normalizeSubscriberEmail),phone:z.string().trim().max(50).default(''),employeeCode:z.string().trim().max(50).default(''),department:z.string().trim().max(100).default(''),designation:z.string().trim().max(100).default(''),enabled:z.boolean(),permissions:z.array(permission).max(modules.length)}).strict();
export const watermarkSchema=z.object({position:z.enum(['center','top-left','top-right','bottom-left','bottom-right']),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),opacity:z.number().min(0.03).max(0.6),rotation:z.number().int().min(-60).max(60),fontSize:z.number().int().min(12).max(48),revision:z.number().int().nonnegative()}).strict();
export const defaultWatermark={position:'center',color:'#64748b',opacity:0.12,rotation:-20,fontSize:24,revision:0};
export async function watermarkSettings(db:Pick<PrismaClient,'watermarkSettings'>){return await db.watermarkSettings.findUnique({where:{id:'default'}})??defaultWatermark;}
export function withModulePermissions(db:PrismaClient,authenticate:(req:FastifyRequest,requireFeatures?:boolean)=>Promise<Principal>){
 return async(req:FastifyRequest)=>{
  const p=await authenticate(req);if(p.roles.includes('SUPER_ADMIN')||p.roles.every(r=>r==='STUDENT'))return p;
  const profile=await db.employeeProfile.findUnique({where:{userId:p.userId}});if(!profile)return p;
  const path=req.url.split('?')[0]!;
  let module=path.includes('/subscribers')?'Subscribers':path.includes('/documents')||path.includes('/folders')?'Uploads':path.includes('/sessions')?'Sessions':path.includes('/notifications')?'Notifications':path.includes('/analytics')?'Analytics':path.includes('/watermark')?'Watermark':path.includes('/academic')?'Academic Mapping':null;
  if(!module)return p;
  const grants=await db.modulePermission.findMany({where:{userId:p.userId}});
  const reading=req.method==='GET';
  // Catalog/context data are dependencies of all targeted content modules.
  const context=reading&&(path==='/v1/academic/catalog'||path.endsWith('/context')||path.endsWith('/programmes'));
  const allowed=context?grants.some(g=>g.canView):grants.some(g=>g.module===module&&(reading?g.canView:g.canManage));
  if(!allowed)throw new AuthError(403,reading?'You do not have View permission for this module':'You do not have Manage permission for this module');
  return {...p,moduleAuthorized:true,canManageModule:grants.some(g=>g.module===module&&g.canManage)};
 };
}
export function registerWorkspaceControls(app:FastifyInstance,db:PrismaClient,authenticate:(req:FastifyRequest)=>Promise<Principal>){
 app.get('/v1/admin/employees',async req=>{const p=await authenticate(req);assertRole({...p,moduleAuthorized:false},['SUPER_ADMIN']);return {items:await db.user.findMany({where:{employeeProfile:{isNot:null}},select:{id:true,displayName:true,email:true,phone:true,enabled:true,revision:true,employeeProfile:true,modulePermissions:true},orderBy:{displayName:'asc'}})}});
 app.post('/v1/admin/employees',async req=>{
  const p=await authenticate(req);assertRole({...p,moduleAuthorized:false},['SUPER_ADMIN']);const input=employee.parse(req.body);
  if(new Set(input.permissions.map(g=>g.module)).size!==input.permissions.length)throw new AuthError(422,'Each module can be mapped only once');
  try{return await db.$transaction(async tx=>{
   let id=input.id;
   const existing=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${input.email}`;
   if(existing.some(u=>u.id!==id))throw new AuthError(409,'This email is already assigned to another account');
   if(id){
    const user=await tx.user.findUnique({where:{id},include:{roles:true,employeeProfile:true}});
    if(!user?.employeeProfile||user.roles.some(r=>r.role==='SUPER_ADMIN'||r.role==='STUDENT')||id===p.userId)throw new AuthError(403,'This account cannot be edited as an employee');
    const changed=await tx.user.updateMany({where:{id,revision:input.revision},data:{displayName:input.displayName,email:input.email,phone:input.phone||null,enabled:input.enabled,revision:{increment:1}}});
    if(!changed.count)throw new AuthError(409,'Employee changed elsewhere. Reopen their details.');
    if(user.email!==input.email||!input.enabled){await tx.appSession.deleteMany({where:{userId:id}});await tx.loginChallenge.deleteMany({where:{userId:id}})}
   }else{id=randomUUID();await tx.user.create({data:{id,identitySub:`email-otp:${randomUUID()}`,displayName:input.displayName,email:input.email,phone:input.phone||null,enabled:input.enabled,roles:{create:{role:'CONTENT_MANAGER'}}}})}
   await tx.employeeProfile.upsert({where:{userId:id},create:{userId:id,employeeCode:input.employeeCode,department:input.department,designation:input.designation},update:{employeeCode:input.employeeCode,department:input.department,designation:input.designation}});
   await tx.modulePermission.deleteMany({where:{userId:id}});await tx.modulePermission.createMany({data:input.permissions.map(g=>({...g,userId:id!}))});
   await tx.auditEvent.create({data:{actorId:p.userId,targetId:id,action:'EMPLOYEE_PERMISSIONS_SAVED',details:{modules:input.permissions.map(g=>({module:g.module,view:g.canView,manage:g.canManage}))}}});return {id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable})}catch(error){if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))throw new AuthError(409,'Employee changed concurrently or this email is already assigned.');throw error}
 });
 app.get('/v1/admin/watermark',async req=>{const p=await authenticate(req);assertRole(p,['SUPER_ADMIN','CONTENT_MANAGER']);return watermarkSettings(db)});
 app.put('/v1/admin/watermark',async req=>{const p=await authenticate(req);assertRole(p,['SUPER_ADMIN']);const input=watermarkSchema.parse(req.body);await db.$transaction(async tx=>{
  const updated=await tx.watermarkSettings.updateMany({where:{id:'default',revision:input.revision},data:{...input,revision:{increment:1}}});if(!updated.count)throw new AuthError(409,'Watermark settings changed elsewhere. Reopen settings.');
  await tx.auditEvent.create({data:{actorId:p.userId,targetId:p.userId,action:'WATERMARK_SETTINGS_UPDATED',details:input}});
 });return watermarkSettings(db)});
 app.get('/v1/admin/analytics',async req=>{
  const p=await authenticate(req);assertRole(p,['SUPER_ADMIN','CONTENT_MANAGER']);
  const q=z.object({courseId:z.string().uuid().optional(),programmeId:z.string().uuid().optional(),planId:z.string().uuid().optional(),status:z.enum(['ALL','ACTIVE','EXPIRED','SCHEDULED','LOCKED']).default('ALL'),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).parse(req.query);
  const from=q.from?new Date(`${q.from}T00:00:00+05:30`):new Date(Date.now()-30*86400000),to=q.to?new Date(`${q.to}T23:59:59.999+05:30`):new Date();if(!Number.isFinite(+from)||!Number.isFinite(+to)||from>to)throw new AuthError(422,'Choose a valid date range');
  const scope={...(q.courseId?{courseId:q.courseId}:{}),...(q.programmeId?{programmeId:q.programmeId}:{}),...(q.planId?{planId:q.planId}:{})};
  const [users,docs,sessions,courses,plans,programmes]=await Promise.all([
   db.user.findMany({where:{roles:{some:{role:'STUDENT'}},...(Object.keys(scope).length?{enrollments:{some:scope}}:{})},include:{enrollments:true,appSessions:{select:{lastSeenAt:true}},materialViews:{where:{lastOpenedAt:{gte:from,lte:to}},select:{documentId:true,lastOpenedAt:true}}}}),
   db.document.findMany({where:{state:'PUBLISHED',...(q.courseId?{courseId:q.courseId}:{}),...(q.programmeId?{programmeId:q.programmeId}:{}),...(q.planId?{grants:{some:{planId:q.planId}}}:{})},include:{grants:true,materialViews:{where:{lastOpenedAt:{gte:from,lte:to}},select:{userId:true}}}}),
   db.liveSession.findMany({where:{publishedAt:{not:null},...(q.courseId?{courseId:q.courseId}:{}),...(q.programmeId?{programmeId:q.programmeId}:{}),...(q.planId?{plans:{some:{planId:q.planId}}}:{}),...((q.from||q.to)?{startAt:{gte:from,lte:to}}:{})},select:{id:true,topic:true,courseId:true,programmeId:true,status:true}}),
   db.academicCourse.findMany({select:{id:true,name:true}}),db.academicPlan.findMany({select:{id:true,name:true}}),db.academicProgramme.findMany({select:{id:true,name:true,courseId:true}}),
  ]);
  const students=users.filter(u=>q.status==='ALL'||subscriberState(u.enabled,u.enrollments.filter(g=>(!q.courseId||g.courseId===q.courseId)&&(!q.programmeId||g.programmeId===q.programmeId)&&(!q.planId||g.planId===q.planId)),new Date())===q.status);
  const events=await db.auditEvent.findMany({where:{actorId:{in:students.map(u=>u.id)},createdAt:{gte:from,lte:to}},select:{actorId:true,targetId:true,createdAt:true,action:true}});
  const relevant=(g:{courseId:string;programmeId:string;planId:string})=>(!q.courseId||g.courseId===q.courseId)&&(!q.programmeId||g.programmeId===q.programmeId)&&(!q.planId||g.planId===q.planId);
  const lastActivity=(u:typeof users[number])=>Math.max(0,...u.appSessions.map(s=>+s.lastSeenAt),...u.materialViews.map(v=>+v.lastOpenedAt),...events.filter(e=>e.actorId===u.id).map(e=>+e.createdAt));
  const engaged=(u:typeof users[number])=>u.appSessions.some(s=>s.lastSeenAt>=from&&s.lastSeenAt<=to)||u.materialViews.length>0||events.some(e=>e.actorId===u.id);
  const studentIds=new Set(students.map(u=>u.id));
  const materials=docs.map(d=>{
   const eligible=students.filter(u=>u.enrollments.some(g=>g.courseId===d.courseId&&g.programmeId===d.programmeId&&g.subjectId===d.subjectId&&d.grants.some(p=>p.planId===g.planId)&&relevant(g)));
   const eligibleIds=new Set(eligible.map(u=>u.id)),opened=new Set([...d.materialViews.filter(v=>studentIds.has(v.userId)&&eligibleIds.has(v.userId)).map(v=>v.userId),...events.filter(e=>e.targetId===d.id&&e.actorId&&eligibleIds.has(e.actorId)&&['DOCUMENT_PREVIEW_AUTHORIZED','DOCUMENT_READ_AUTHORIZED'].includes(e.action)).map(e=>e.actorId!)]);
   return {id:d.id,title:d.title,programme:programmes.find(p=>p.id===d.programmeId)?.name??'Programme',opened:opened.size,notOpened:eligible.length-opened.size};
  });
  return {courseCoverage:courses.filter(c=>!q.courseId||c.id===q.courseId).map(c=>({id:c.id,name:c.name,pdfs:docs.filter(d=>d.courseId===c.id).length,sessions:sessions.filter(s=>s.courseId===c.id).length})),period:{from,to},students:students.length,engaged:students.filter(engaged).length,inactive:students.filter(u=>!engaged(u)).map(u=>({id:u.id,name:u.displayName,email:u.email,status:subscriberState(u.enabled,u.enrollments,new Date()),lastSeen:lastActivity(u)?new Date(lastActivity(u)).toISOString():null})),byCourse:courses.map(c=>({id:c.id,name:c.name,count:students.filter(u=>u.enrollments.some(g=>g.courseId===c.id&&relevant(g))).length})).filter(c=>c.count),byPlan:plans.map(p=>({id:p.id,name:p.name,count:students.filter(u=>u.enrollments.some(g=>g.planId===p.id&&relevant(g))).length})).filter(p=>p.count),materials,byProgramme:programmes.filter(p=>!q.courseId||p.courseId===q.courseId).filter(p=>!q.programmeId||p.id===q.programmeId).map(p=>({id:p.id,name:p.name,pdfs:docs.filter(d=>d.programmeId===p.id).length,sessions:sessions.filter(s=>s.programmeId===p.id).length})),sessions:sessions.length};
 });
}
