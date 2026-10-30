/** Run via stdin inside the disposable Docker smoke-test API container only. */
import {PrismaClient} from '@prisma/client';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {publishNotification} from './dist/notification-delivery.js';
if(process.env.NODE_ENV!=='development'||process.env.CAPACITY_SMOKE!=='1')throw new Error('Explicit development-only smoke-test flag required');
const db=new PrismaClient();
try{
 if(await db.user.count()!==1)throw new Error('Expected a fresh disposable database with only the bootstrap administrator');
 const admin=await db.user.findFirstOrThrow({where:{roles:{some:{role:'SUPER_ADMIN'}}}}),key=randomUUID(),secret=randomBytes(32).toString('base64url');
 const fixture=await db.$transaction(async tx=>{
  const course=await tx.academicCourse.create({data:{name:'Smoke course',nameKey:key,code:key}}),subject=await tx.academicSubject.create({data:{name:'Smoke subject',nameKey:key}});
  const plan=await tx.academicPlan.create({data:{name:'Smoke plan',nameKey:key,courseId:course.id}});
  const programme=await tx.academicProgramme.create({data:{name:'Smoke programme',nameKey:key,courseId:course.id,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
  const student=await tx.user.create({data:{identitySub:key,email:`smoke-${key}@example.invalid`,roles:{create:{role:'STUDENT'}},enrollments:{create:{courseId:course.id,programmeId:programme.id,planId:plan.id,subjectId:subject.id,activeFrom:new Date(Date.now()-1000)}}}});
  await tx.appSession.create({data:{userId:student.id,email:student.email,tokenHash:createHash('sha256').update(secret).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
  const input={kind:'MATERIAL',title:'Worker smoke test',body:'Synthetic notification only',createdById:admin.id,eventKey:`smoke:${key}`,sourceId:randomUUID(),courseIds:[course.id],programmeIds:[programme.id],planIds:[plan.id],subjectId:subject.id};
  const notification=await publishNotification(tx,input);if((await publishNotification(tx,input)).id!==notification.id)throw new Error('Duplicate publication');
  return {userId:student.id,notificationId:notification.id};
 });
 const deadline=Date.now()+15000;let delivered=false;
 while(Date.now()<deadline){const job=await db.notificationDeliveryJob.findUnique({where:{notificationId:fixture.notificationId}});if(job?.completedAt&&job.delivered===1){delivered=true;break}await new Promise(resolve=>setTimeout(resolve,100))}
 if(!delivered)throw new Error('Notification worker did not complete delivery');
 if(await db.notificationRecipient.count({where:{notificationId:fixture.notificationId}})!==1)throw new Error('Wrong recipient count');
 const cookieName=process.env.CORS_ORIGIN.startsWith('https:')?'__Host-dochub_session':'dochub_session',headers={Cookie:`${cookieName}=${secret}`},origin='http://127.0.0.1:3001';
 const before=await fetch(`${origin}/v1/changes`,{headers});if(!before.ok)throw new Error('Authenticated change request failed');const previous=await before.json();if(previous.unreadCount!==1)throw new Error('Missing unread count');
 const read=await fetch(`${origin}/v1/student/notifications/${fixture.notificationId}/read`,{method:'POST',headers:{...headers,Origin:process.env.CORS_ORIGIN,'Content-Type':'application/json'},body:'{}'});if(!read.ok)throw new Error('Notification read failed');
 const after=await fetch(`${origin}/v1/changes`,{headers}),current=await after.json();if(!after.ok||current.unreadCount!==0||current.inboxVersion===previous.inboxVersion)throw new Error('Unread revision did not update');
 console.log('Docker notification worker, authenticated change checks, unread counters and read acknowledgement passed.');
}finally{await db.$disconnect()}
