import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {PrismaClient,type Prisma} from '@prisma/client';
import {registerNotifications} from '../src/notifications.js';
import {notificationAudienceCount,deliverNotificationBatch} from '../src/notification-delivery.js';
import {publishDocument} from '../src/document-publication.js';
import {registerSessions} from '../src/sessions.js';
import type {Principal} from '../src/auth.js';
const db=new PrismaClient(),rollback=new Error('rollback fixtures');
test('notification targeting, files, views and automatic publication',async t=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local database only');
 try{await db.$transaction(async tx=>{
  const key=randomUUID(),actor=await tx.user.create({data:{identitySub:randomUUID(),roles:{create:{role:'SUPER_ADMIN'}}}});
  const course=await tx.academicCourse.create({data:{name:key,nameKey:key,code:key}});
  const subject=await tx.academicSubject.create({data:{name:key,nameKey:key}}),faculty=await tx.academicFaculty.create({data:{name:key,nameKey:key}});
  const plans=await Promise.all([0,1].map(i=>tx.academicPlan.create({data:{name:`Plan ${i}`,nameKey:`${key}-${i}`,courseId:course.id}})));
  const programme=await tx.academicProgramme.create({data:{name:key,nameKey:key,courseId:course.id,locked:true,plans:{create:plans.map(p=>({planId:p.id}))},subjects:{create:{subjectId:subject.id}}}});
  const makeStudent=(enabled=true,window='active')=>tx.user.create({data:{identitySub:randomUUID(),displayName:'Notification Student',email:`${randomUUID()}@example.com`,enabled,roles:{create:{role:'STUDENT'}},...(window==='none'?{}:{enrollments:{create:plans.map(p=>({courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:p.id,activeFrom:new Date(Date.now()+(window==='future'?86400000:-86400000)),validUntil:window==='expired'?new Date(Date.now()-1000):null}))}})}});
  const student=await makeStudent(),second=await makeStudent(),outsider=await makeStudent(true,'none');
  await makeStudent(false);await makeStudent(true,'expired');await makeStudent(true,'future');
  const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
  let principal:Principal={userId:actor.id,roles:['SUPER_ADMIN']};
  const admin=()=>{principal={userId:actor.id,roles:['SUPER_ADMIN']}};
  const learner=(id=student.id)=>{principal={userId:id,roles:['STUDENT']}};
  const app=Fastify();registerNotifications(app,scopedDb,async()=>principal,async()=>{});registerSessions(app,scopedDb,async()=>principal);
  const drain=async()=>{let batches=0;while(await deliverNotificationBatch(scopedDb,1)){assert.ok(++batches<100)}};
  const target={courseIds:[course.id],programmeIds:[programme.id],planIds:plans.map(p=>p.id)};
  const draft={title:'Your course update',body:'Read the attached study checklist.',target,requestId:randomUUID(),attachments:[{name:'checklist.txt',mimeType:'text/plain',base64:Buffer.from('Study checklist').toString('base64')}]};
  let notificationId='',attachmentId='';
  try{
   await t.test('audience deduplicates grants and excludes expired, scheduled, locked and unrelated users',async()=>{
    const r=await app.inject({method:'POST',url:'/v1/admin/notifications/audience',payload:target});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().count,2);
    assert.equal(await notificationAudienceCount(tx,target),2);
    assert.equal((await app.inject({method:'POST',url:'/v1/admin/notifications/audience',payload:{...target,programmeIds:[randomUUID()]}})).statusCode,422);
   });
   await t.test('send persists text and files once with idempotent retry',async()=>{
    let r=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:draft});assert.equal(r.statusCode,201,r.body);assert.equal(r.json().recipients,2);notificationId=r.json().id;assert.equal(r.json().queued,true);assert.equal(await tx.notificationRecipient.count({where:{notificationId}}),0);const queuedRetry=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:draft});assert.equal(queuedRetry.json().recipients,2);assert.equal(queuedRetry.json().queued,true);await drain();
    r=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:draft});assert.equal(r.json().id,notificationId);
    assert.equal(await tx.notification.count({where:{eventKey:`custom:${actor.id}:${draft.requestId}`}}),1);
    r=await app.inject({url:`/v1/admin/notifications/${notificationId}`});assert.equal(r.json().viewers,0);attachmentId=r.json().attachments[0].id;assert.equal(r.json().attachments[0].data,undefined);
   });
   await t.test('listing does not count as a view; repeated opens count only once',async()=>{
    learner();let r=await app.inject({url:'/v1/student/notifications'});assert.equal(r.json().items.length,1);assert.equal(r.json().items[0].readAt,null);
    assert.equal((await app.inject({url:'/v1/student/notifications/unread'})).json().count,1);
    admin();assert.equal((await app.inject({url:`/v1/admin/notifications/${notificationId}`})).json().viewers,0);
    learner();for(let i=0;i<2;i++)assert.equal((await app.inject({method:'POST',url:`/v1/student/notifications/${notificationId}/read`,payload:{}})).statusCode,200);
    assert.equal((await app.inject({url:'/v1/student/notifications/unread'})).json().count,0);
    admin();r=await app.inject({url:`/v1/admin/notifications/${notificationId}`});assert.equal(r.json().viewers,1);assert.equal(r.json().people[0].user.id,student.id);
    assert.equal((await app.inject({url:'/v1/admin/notifications?kind=CUSTOM'})).json().items[0].viewers,1);
   });
   await t.test('messages and attachments are recipient-only',async()=>{
    learner();const url=`/v1/notifications/${notificationId}/attachments/${attachmentId}`;
    const r=await app.inject({url});assert.equal(r.statusCode,200);assert.equal(r.body,'Study checklist');assert.match(String(r.headers['content-disposition']),/^attachment/);assert.equal(r.headers['x-content-type-options'],'nosniff');
    learner(outsider.id);assert.equal((await app.inject({url})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:`/v1/student/notifications/${notificationId}/read`,payload:{}})).statusCode,404);
    assert.equal((await app.inject({url:'/v1/student/notifications'})).json().total,0);assert.equal((await app.inject({url:'/v1/admin/notifications'})).statusCode,403);admin();
   });
   await t.test('unsupported and disguised attachments are rejected before delivery',async()=>{
    for(const f of [{name:'payload.html',mimeType:'text/html',base64:Buffer.from('<script>bad</script>').toString('base64')},{name:'fake.pdf',mimeType:'application/pdf',base64:Buffer.from('not a PDF').toString('base64')}]){
     const r=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:{...draft,requestId:randomUUID(),attachments:[f]}});assert.equal(r.statusCode,422,r.body);
    }
   });
   await t.test('material publication creates one regular notification across retries',async()=>{
    const d=await tx.document.create({data:{title:'Test material',courseId:course.id,programmeId:programme.id,subjectId:subject.id,createdById:actor.id,state:'READY',grants:{create:plans.map(p=>({planId:p.id}))}}});
    const v=await tx.documentVersion.create({data:{documentId:d.id,number:1,state:'READY',objectKey:randomUUID(),sizeBytes:123,previewReady:true,pageCount:1}});
    await publishDocument(tx,d.id,principal);await publishDocument(tx,d.id,principal);await drain();
    const n=await tx.notification.findUniqueOrThrow({where:{eventKey:`material:${v.id}`},include:{recipients:true}});assert.equal(n.kind,'MATERIAL');assert.equal(n.recipients.length,2);assert.equal(n.sourceId,d.id);
   });
   await t.test('session publication creates one regular update for unchanged repeated publish',async()=>{
    const s=await tx.liveSession.create({data:{topic:'Live anatomy',facultyId:faculty.id,facultyName:faculty.name,courseId:course.id,programmeId:programme.id,subjectId:subject.id,startAt:new Date(Date.now()+3600000),endAt:new Date(Date.now()+7200000),status:'SCHEDULED',platform:'DOCTUTORIALS_APP',createdById:actor.id,updatedById:actor.id,plans:{create:plans.map(p=>({planId:p.id}))}}});
    const url=`/v1/admin/sessions/${s.id}/publication`;
    let r=await app.inject({method:'POST',url,payload:{revision:0,publish:true}});assert.equal(r.statusCode,200,r.body);
    r=await app.inject({method:'POST',url,payload:{revision:1,publish:true}});assert.equal(r.statusCode,200,r.body);
    assert.equal(await tx.notification.count({where:{sourceId:s.id,kind:'SESSION'}}),1);
    principal={userId:actor.id,roles:['CONTENT_MANAGER']};
    assert.equal((await app.inject({url:'/v1/admin/notifications?kind=REGULAR'})).json().total,2);admin();
   });
   await t.test('sync recovers legacy publications once, preserves dates and leaves drafts private',async()=>{
    const publishedAt=new Date(Date.now()-86400000);
    const d=await tx.document.create({data:{title:'Legacy resource',courseId:course.id,programmeId:programme.id,subjectId:subject.id,createdById:actor.id,state:'PUBLISHED',publishedAt,grants:{create:plans.map(p=>({planId:p.id}))}}});
    const v=await tx.documentVersion.create({data:{documentId:d.id,number:1,state:'PUBLISHED',objectKey:randomUUID(),sizeBytes:123,previewReady:true,pageCount:1}});
    const fields={topic:'Legacy session',facultyId:faculty.id,facultyName:faculty.name,courseId:course.id,programmeId:programme.id,subjectId:subject.id,startAt:new Date(),endAt:new Date(Date.now()+3600000),status:'SCHEDULED' as const,platform:'DOCTUTORIALS_APP' as const,createdById:actor.id,updatedById:actor.id};
    const unpublished=await tx.liveSession.create({data:fields});
    const old=await tx.liveSession.create({data:{...fields,publishedAt,revision:1,plans:{create:plans.map(p=>({planId:p.id}))}}});
    principal={userId:actor.id,roles:['CONTENT_MANAGER']};
    let r=await app.inject({method:'POST',url:'/v1/admin/notifications/sync-publications',payload:{}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().created,2);await drain();
    const n=await tx.notification.findUniqueOrThrow({where:{eventKey:`material:${v.id}`},include:{recipients:true}});assert.equal(n.recipients.length,2);assert.equal(n.createdAt.toISOString(),publishedAt.toISOString());
    assert.equal(await tx.notification.count({where:{sourceId:unpublished.id}}),0);assert.equal(await tx.notification.count({where:{sourceId:old.id}}),1);
    r=await app.inject({method:'POST',url:'/v1/admin/notifications/sync-publications',payload:{}});assert.equal(r.statusCode,200);assert.equal(r.json().created,0);admin();
   });
   await t.test('another content manager cannot read a sender’s viewer identities',async()=>{
    principal={userId:randomUUID(),roles:['CONTENT_MANAGER']};assert.equal((await app.inject({url:`/v1/admin/notifications/${notificationId}`})).statusCode,404);
    assert.equal((await app.inject({url:'/v1/admin/notifications'})).json().total,0);admin();
   });
   await t.test('batch delivery rechecks revoked access and never duplicates receipts',async()=>{
    admin();const r=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:{...draft,requestId:randomUUID()}});assert.equal(r.statusCode,201,r.body);const id=r.json().id;
    assert.equal(await deliverNotificationBatch(scopedDb,1),true);
    const job=await tx.notificationDeliveryJob.findUniqueOrThrow({where:{notificationId:id}});
    const revoked=[student.id,second.id].find(id=>id!==job.cursor)!;await tx.user.update({where:{id:revoked},data:{enabled:false}});
    await drain();assert.equal(await tx.notificationRecipient.count({where:{notificationId:id}}),1);assert.equal(await tx.notificationRecipient.count({where:{notificationId:id,userId:revoked}}),0);
    assert.equal((await tx.notificationDeliveryJob.findUniqueOrThrow({where:{notificationId:id}})).delivered,1);
    await drain();assert.equal(await tx.notificationRecipient.count({where:{notificationId:id}}),1);await tx.user.update({where:{id:revoked},data:{enabled:true}});
   });
   await t.test('failed batches retain their cursor and retry without lost or duplicate deliveries',async()=>{
    admin();const r=await app.inject({method:'POST',url:'/v1/admin/notifications',payload:{...draft,requestId:randomUUID()}});assert.equal(r.statusCode,201,r.body);const id=r.json().id;
    const failing=new Proxy(scopedDb,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(new Proxy(tx,{get(inner,key,receiver){if(key==='notificationRecipient')return {createMany:async()=>{throw new Error('Injected batch failure')}};return Reflect.get(inner,key,receiver)}}));return Reflect.get(target,prop,receiver)}}) as PrismaClient;
    await assert.rejects(deliverNotificationBatch(failing,1),/Injected batch failure/);
    const failed=await tx.notificationDeliveryJob.findUniqueOrThrow({where:{notificationId:id}});assert.equal(failed.cursor,null);assert.equal(failed.attempts,1);assert.equal(await tx.notificationRecipient.count({where:{notificationId:id}}),0);
    await tx.notificationDeliveryJob.update({where:{notificationId:id},data:{nextAttemptAt:new Date(Date.now()-1000)}});await drain();assert.equal(await tx.notificationRecipient.count({where:{notificationId:id}}),2);assert.equal((await tx.notificationDeliveryJob.findUniqueOrThrow({where:{notificationId:id}})).completedAt instanceof Date,true);
   });
  }finally{await app.close()}
  throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect()}
});
