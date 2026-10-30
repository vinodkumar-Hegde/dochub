/** Synthetic local scale probe; application DATABASE_URL is never used. */
import {PrismaClient} from '@prisma/client';
import Fastify from 'fastify';
import type {S3Client} from '@aws-sdk/client-s3';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadConfig} from '../src/config.js';
import {registerEmailOtp} from '../src/email-otp.js';
import {withModulePermissions,registerWorkspaceControls} from '../src/workspace-controls.js';
import {registerDocuments} from '../src/documents.js';
import {registerNotifications} from '../src/notifications.js';
import {publishNotification} from '../src/notification-delivery.js';
const url=process.env.CAPACITY_DATABASE_URL;if(!url)throw new Error('Explicit CAPACITY_DATABASE_URL required');
const target=new URL(url);
if(!['localhost','127.0.0.1','::1'].includes(target.hostname)||!target.pathname.startsWith('/dochub_capacity'))throw new Error('Only a dedicated local dochub_capacity* database is permitted');
const output=process.env.CAPACITY_REPORT_DIR??join(tmpdir(),'dochub-capacity-report');await mkdir(output,{recursive:true});
let queries=0;const db=new PrismaClient({datasourceUrl:url,log:[{emit:'event',level:'query'}]});db.$on('query',()=>queries++);
const mode=process.argv[2]??'reads';
try{
 if(mode==='seed'){
  if(await db.user.count())throw new Error('Seed requires an empty disposable database');
  const count=80000;
  const admin=await db.user.create({data:{identitySub:randomUUID(),email:'capacity-admin@example.invalid',roles:{create:{role:'SUPER_ADMIN'}}}});
  const course=await db.academicCourse.create({data:{name:'Synthetic course',nameKey:'capacity',code:'CAPACITY'}});
  const subject=await db.academicSubject.create({data:{name:'Synthetic subject',nameKey:'capacity'}});
  const plan=await db.academicPlan.create({data:{name:'Synthetic plan',nameKey:'capacity',courseId:course.id}});
  const programme=await db.academicProgramme.create({data:{name:'Synthetic programme',nameKey:'capacity',courseId:course.id,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
  await db.$executeRaw`INSERT INTO "User" (id,"identitySub",email,"displayName") SELECT md5('student-'||n)::uuid,'synthetic-'||n,'capacity-'||n||'@example.invalid','Synthetic student '||n FROM generate_series(1,${count}::int) n`;
  await db.$executeRaw`INSERT INTO "UserProfile" ("userId",role) SELECT md5('student-'||n)::uuid,'STUDENT'::"UserRole" FROM generate_series(1,${count}::int) n`;
  await db.$executeRaw`INSERT INTO "Enrollment" ("userId","courseId","programmeId","subjectId","planId","activeFrom") SELECT md5('student-'||n)::uuid,${course.id},${programme.id},${subject.id},${plan.id},NOW()-INTERVAL '1 day' FROM generate_series(1,${count}::int) n`;
  await db.$executeRaw`INSERT INTO "AppSession" (id,"userId",email,"tokenHash","lastSeenAt","expiresAt") SELECT md5('session-'||n)::uuid,md5('student-'||n)::uuid,'capacity-'||n||'@example.invalid',encode(sha256(convert_to(lpad(n::text,43,'x'),'UTF8')),'hex'),NOW(),NOW()+INTERVAL '12 hours' FROM generate_series(1,${count}::int) n`;
  const docs=[];for(let n=0;n<100;n++){const doc=await db.document.create({data:{title:`Synthetic material ${n+1}`,courseId:course.id,programmeId:programme.id,subjectId:subject.id,createdById:admin.id,state:'PUBLISHED',publishedAt:new Date(),grants:{create:{planId:plan.id}},versions:{create:{number:1,state:'PUBLISHED',objectKey:`capacity/${randomUUID()}`,sizeBytes:1024n,pageCount:2000,previewReady:true}}}});docs.push(doc.id)}
  await db.$executeRaw`INSERT INTO "MaterialView" ("userId","documentId") SELECT md5('student-'||n)::uuid,${docs[0]}::uuid FROM generate_series(1,${count}::int) n`;
  await db.$executeRaw`INSERT INTO "AuditEvent" (id,"actorId",action,"targetId",details) SELECT md5('event-'||n)::uuid,md5('student-'||n)::uuid,'DOCUMENT_PREVIEW_AUTHORIZED',${docs[0]}::uuid,'{}'::jsonb FROM generate_series(1,${count}::int) n`;
  const notification=await db.notification.create({data:{kind:'CUSTOM',title:'Synthetic message',body:'Synthetic capacity fixture',createdById:admin.id,courseIds:[course.id],programmeIds:[programme.id],planIds:[plan.id]}});
  await db.$executeRaw`INSERT INTO "NotificationRecipient" ("notificationId","userId") SELECT ${notification.id}::uuid,md5('student-'||n)::uuid FROM generate_series(1,${count}::int) n`;
  await db.$executeRaw`ANALYZE`;
  const fixture={students:count,materials:docs.length,adminId:admin.id,courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:plan.id,documentId:docs[0]};await writeFile(join(output,'fixture.json'),JSON.stringify(fixture,null,2));console.log(JSON.stringify(fixture));
 }else{
  const f=JSON.parse(await readFile(join(output,'fixture.json'),'utf8'));let peak=process.memoryUsage().rss;
  const timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),50),started=performance.now();
  try{
   if(mode==='fanout'){
    const result=await db.$transaction(tx=>publishNotification(tx,{kind:'MATERIAL',title:'Synthetic fanout',body:'Synthetic benchmark only',createdById:f.adminId,eventKey:`capacity:${randomUUID()}`,sourceId:f.documentId,courseIds:[f.courseId],programmeIds:[f.programmeId],planIds:[f.planId],subjectId:f.subjectId}));
    const report={mode,elapsedMs:Math.round(performance.now()-started),recipients:await db.notificationRecipient.count({where:{notificationId:result.id}}),queries,peakNodeRssMiB:Math.round(peak/1024**2)};await writeFile(join(output,'fanout.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
   }else if(mode==='reads'||mode==='analytics'){
    const cfg=loadConfig({DATABASE_URL:url,AWS_REGION:'ap-south-1',S3_BUCKET:'synthetic-private-bucket',SQS_QUEUE_URL:'https://sqs.ap-south-1.amazonaws.com/000000000000/synthetic',CORS_ORIGIN:'http://localhost:5190'}),app=Fastify();
    const session=registerEmailOtp(app,db,cfg,async()=>{throw new Error('Capacity tests must not send email')}),authenticate=withModulePermissions(db,session);
    if(mode==='analytics')registerWorkspaceControls(app,db,async()=>({userId:f.adminId,roles:['SUPER_ADMIN']}));else{registerDocuments(app,db,{} as S3Client,cfg,authenticate);registerNotifications(app,db,authenticate)}
    try{
     const endpoints=mode==='analytics'?['/v1/admin/analytics']:['/v1/student/materials','/v1/student/catalogue','/v1/student/notifications/unread','/auth/session'],measurements=[];
     for(const endpoint of endpoints){
      const count=mode==='analytics'?1:200,concurrency=mode==='analytics'?1:20,durations:number[]=[],statuses:Record<string,number>={},errors:string[]=[];let next=0;const queryStart=queries,begin=performance.now();
      await Promise.all(Array.from({length:concurrency},async()=>{while(next<count){const n=++next,t=performance.now(),response=await app.inject({url:endpoint,headers:{cookie:`dochub_session=${String(n).padStart(43,'x')}`}});durations.push(performance.now()-t);statuses[response.statusCode]=(statuses[response.statusCode]??0)+1;if(response.statusCode!==200&&errors.length<2)errors.push(response.json().message?.slice(-1200))}}));
      if(Object.keys(statuses).some(status=>status!=='200'))process.exitCode=1;
      durations.sort((a,b)=>a-b);const elapsed=performance.now()-begin;
      measurements.push({endpoint,requests:count,concurrency,statuses,errors,elapsedMs:Math.round(elapsed),requestsPerSecond:+(count/(elapsed/1000)).toFixed(1),p50Ms:Math.round(durations[Math.floor(count*.5)]!),p95Ms:Math.round(durations[Math.min(count-1,Math.floor(count*.95))]!),queries:queries-queryStart});
     }
     const result={mode,students:f.students,materials:f.materials,measurements,peakNodeRssMiB:Math.round(peak/1024**2),transport:'Fastify inject (no network/TLS)',cloudServices:'not exercised'};await writeFile(join(output,`${mode}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    }finally{await app.close()}
   }else throw new Error('Expected seed, reads, fanout or analytics');
  }catch(error){const report={mode,elapsedMs:Math.round(performance.now()-started),error:error instanceof Error?error.message.slice(-1200):String(error),queries,peakNodeRssMiB:Math.round(Math.max(peak,process.memoryUsage().rss)/1024**2)};await writeFile(join(output,`${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=1}finally{clearInterval(timer)}
 }
}finally{await db.$disconnect()}
