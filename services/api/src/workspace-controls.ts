import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {AuthError,assertRole,type Principal} from './auth.js';
import {analyticsQuery,readAnalytics} from './analytics.js';
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
  return readAnalytics(db,analyticsQuery.parse(req.query));
 });
}
