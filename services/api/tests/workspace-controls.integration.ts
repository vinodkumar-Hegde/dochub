import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import Fastify from 'fastify';import {PrismaClient,type Prisma} from '@prisma/client';
import {registerWorkspaceControls,withModulePermissions} from '../src/workspace-controls.js';import {registerGlobalSearch} from '../src/global-search.js';import {registerSessions} from '../src/sessions.js';import {registerSubscribers} from '../src/subscribers.js';import {loadConfig} from '../src/config.js';import type {Principal} from '../src/auth.js';
const db=new PrismaClient(),rollback=new Error('rollback workspace tests');
test('employee permissions, analytics, watermark settings and scoped global search',async t=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname));
 try{await db.$transaction(async tx=>{
  const key=randomUUID(),admin=await tx.user.create({data:{identitySub:randomUUID(),roles:{create:{role:'SUPER_ADMIN'}}}});
  const course=await tx.academicCourse.create({data:{name:`Course ${key}`,nameKey:key,code:key}}),subject=await tx.academicSubject.create({data:{name:key,nameKey:key}}),plan=await tx.academicPlan.create({data:{name:'Complete plan',nameKey:key,courseId:course.id}});
  const programme=await tx.academicProgramme.create({data:{name:'Scoped programme',nameKey:key,courseId:course.id,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
  const student=await tx.user.create({data:{identitySub:randomUUID(),email:`student-${key}@example.com`,roles:{create:{role:'STUDENT'}},enrollments:{create:{courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:plan.id}}}});
  const doc=await tx.document.create({data:{title:`Unique ${key}`,courseId:course.id,programmeId:programme.id,subjectId:subject.id,createdById:admin.id,state:'PUBLISHED',publishedAt:new Date(),grants:{create:{planId:plan.id}}}});
  await tx.materialView.create({data:{userId:student.id,documentId:doc.id}});
  const outsider=await tx.user.create({data:{identitySub:randomUUID(),email:`outsider-${key}@example.com`,roles:{create:{role:'STUDENT'}}}});
  const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
  let p:Principal={userId:admin.id,roles:['SUPER_ADMIN']};const app=Fastify(),authenticate=withModulePermissions(scopedDb,async()=>p);
  registerWorkspaceControls(app,scopedDb,authenticate);registerGlobalSearch(app,scopedDb,authenticate);registerSessions(app,scopedDb,authenticate);registerSubscribers(app,scopedDb,loadConfig(),authenticate);
  let employeeId='',settings:any;
  try{
   await t.test('administrator creates a persisted employee and maps View and Manage independently',async()=>{
    const r=await app.inject({method:'POST',url:'/v1/admin/employees',payload:{displayName:'Operations colleague',email:`employee-${key}@example.com`,employeeCode:'OPS-1',department:'Education',designation:'Coordinator',enabled:true,permissions:[{module:'Sessions',canView:true,canManage:false},{module:'Subscribers',canView:true,canManage:false},{module:'Watermark',canView:true,canManage:false}]}});assert.equal(r.statusCode,200,r.body);employeeId=r.json().id;
    const user=await tx.user.findUniqueOrThrow({where:{id:employeeId},include:{roles:true,employeeProfile:true,modulePermissions:true}});assert.equal(user.employeeProfile?.department,'Education');assert.deepEqual(user.roles.map(r=>r.role),['CONTENT_MANAGER']);assert.equal(user.modulePermissions.length,3);
   });
   await t.test('employee View access permits reads but rejects writes and employee administration',async()=>{
    p={userId:employeeId,roles:['CONTENT_MANAGER']};assert.equal((await app.inject({url:'/v1/admin/sessions'})).statusCode,200);assert.equal((await app.inject({url:'/v1/admin/subscribers'})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:'/v1/admin/sessions',payload:{}})).statusCode,403);assert.equal((await app.inject({url:'/v1/admin/employees'})).statusCode,403);
    const r=await app.inject({url:'/v1/search?q=Unique'});assert.equal(r.statusCode,200,r.body);assert.ok(!r.json().items.some((h:any)=>h.id===doc.id));
   });
   await t.test('watermark controls are persisted with revision checks and require Manage permission',async()=>{
    let r=await app.inject({url:'/v1/admin/watermark'});assert.equal(r.statusCode,200);const {id,...s}=r.json();settings={...s,position:'bottom-right',color:'#123456',opacity:.2,rotation:0,fontSize:20};
    assert.equal((await app.inject({method:'PUT',url:'/v1/admin/watermark',payload:settings})).statusCode,403);
    p={userId:admin.id,roles:['SUPER_ADMIN']};r=await app.inject({method:'PUT',url:'/v1/admin/watermark',payload:settings});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().position,'bottom-right');assert.equal(r.json().opacity,.2);
    assert.equal((await app.inject({method:'PUT',url:'/v1/admin/watermark',payload:settings})).statusCode,409);
   });
   await t.test('analytics deduplicate students by plan and count material opens against matching subscribers',async()=>{
    const r=await app.inject({url:`/v1/admin/analytics?courseId=${course.id}&planId=${plan.id}`});assert.equal(r.statusCode,200,r.body);const data=r.json();assert.equal(data.students,1);assert.equal(data.byPlan.find((p:any)=>p.id===plan.id).count,1);assert.equal(data.materials[0].opened,1);assert.equal(data.materials[0].notOpened,0);assert.equal(data.byProgramme.find((p:any)=>p.id===programme.id).pdfs,1);
   });
   await t.test('global search returns only entitled materials to students',async()=>{
    p={userId:student.id,roles:['STUDENT']};let r=await app.inject({url:`/v1/search?q=${key}`});assert.equal(r.statusCode,200,r.body);assert.ok(r.json().items.some((h:any)=>h.id===doc.id));
    p={userId:outsider.id,roles:['STUDENT']};r=await app.inject({url:`/v1/search?q=${key}`});assert.equal(r.statusCode,200);assert.ok(!r.json().items.some((h:any)=>h.id===doc.id));
   });
  }finally{await app.close()}throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}
});
