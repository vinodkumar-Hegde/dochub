import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {PrismaClient} from '@prisma/client';
import {registerWorkspaceChanges} from '../src/workspace-changes.js';
const db=new PrismaClient(),rollback=new Error('rollback change fixtures');
test('change tokens and inbox counters are transactional, private and idempotent',async()=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname));
 try{await db.$transaction(async tx=>{
  const a=await tx.user.create({data:{identitySub:randomUUID()}}),b=await tx.user.create({data:{identitySub:randomUUID()}});let userId=a.id;
  const n=await tx.notification.create({data:{kind:'CUSTOM',title:'Test',body:'Private',createdById:a.id,courseIds:[],programmeIds:[],planIds:[]}});
  const app=Fastify();registerWorkspaceChanges(app,tx as unknown as PrismaClient,async()=>({userId,roles:['STUDENT']}));
  const state=async()=>(await app.inject({url:'/v1/changes'})).json();
  try{
   const before=await state();assert.equal(before.unreadCount,0);
   await tx.notificationRecipient.create({data:{notificationId:n.id,userId:a.id}});
   const delivered=await state();assert.equal(delivered.unreadCount,1);assert.notEqual(delivered.inboxVersion,before.inboxVersion);assert.equal(delivered.contentVersion,before.contentVersion);
   userId=b.id;const other=await state();assert.equal(other.unreadCount,0);assert.notEqual(other.inboxVersion,before.inboxVersion);userId=a.id;
   await tx.notificationRecipient.updateMany({where:{notificationId:n.id,userId:a.id,readAt:null},data:{readAt:new Date()}});
   const read=await state();assert.equal(read.unreadCount,0);
   await tx.notificationRecipient.updateMany({where:{notificationId:n.id,userId:a.id,readAt:null},data:{readAt:new Date()}});assert.deepEqual(await state(),read);
   const key=randomUUID();await tx.academicSubject.create({data:{name:key,nameKey:key}});assert.notEqual((await state()).contentVersion,read.contentVersion);
   const courseId=randomUUID();await tx.enrollment.create({data:{userId:a.id,courseId,programmeId:randomUUID(),subjectId:randomUUID(),planId:randomUUID()}});
   userId=b.id;const unaffected=await state();userId=a.id;const scoped=await state();
   await tx.document.create({data:{title:'Scoped change',courseId,programmeId:randomUUID(),subjectId:randomUUID(),createdById:a.id}});
   assert.notEqual((await state()).contentVersion,scoped.contentVersion);userId=b.id;assert.equal((await state()).contentVersion,unaffected.contentVersion);userId=a.id;
   await tx.enrollment.deleteMany({where:{userId:a.id}});
   await tx.user.delete({where:{id:a.id}});assert.equal(await tx.inboxState.findUnique({where:{userId:a.id}}),null);
  }finally{await app.close()}throw rollback;
 },{timeout:30000});}catch(error){if(error!==rollback)throw error}finally{await db.$disconnect()}
});
