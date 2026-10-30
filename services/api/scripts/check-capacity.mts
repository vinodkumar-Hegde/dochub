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
import {publishNotification,deliverNotificationBatch} from '../src/notification-delivery.js';
import {registerWorkspaceChanges} from '../src/workspace-changes.js';
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
  const f=JSON.parse(await readFile(join(output,'fixture.json'),'utf8'));if(!await db.user.findFirst({where:{id:f.adminId,email:'capacity-admin@example.invalid'}})||await db.user.count()!==f.students+1)throw new Error('Database does not match the synthetic fixture manifest');await db.appSession.updateMany({data:{lastSeenAt:new Date(),expiresAt:new Date(Date.now()+12*3600000)}});let peak=process.memoryUsage().rss;
  const timer=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),50),started=performance.now();
  try{
   if(mode==='fanout'||mode==='fanout-concurrent'){
    const result=await db.$transaction(tx=>publishNotification(tx,{kind:'MATERIAL',title:'Synthetic fanout',body:'Synthetic benchmark only',createdById:f.adminId,eventKey:`capacity:${randomUUID()}`,sourceId:f.documentId,courseIds:[f.courseId],programmeIds:[f.programmeId],planIds:[f.planId],subjectId:f.subjectId}));
    const enqueueMs=Math.round(performance.now()-started),recipientsBeforeDelivery=await db.notificationRecipient.count({where:{notificationId:result.id}});let batches=0;for(;;){const results=mode==='fanout-concurrent'?await Promise.all([deliverNotificationBatch(db),deliverNotificationBatch(db)]):[await deliverNotificationBatch(db)];if(!results.some(Boolean))break;batches+=results.filter(Boolean).length;if(batches>10000)throw new Error('Delivery did not finish')}
    const report={mode,enqueueMs,recipientsBeforeDelivery,batches,elapsedMs:Math.round(performance.now()-started),recipients:await db.notificationRecipient.count({where:{notificationId:result.id}}),queries,peakNodeRssMiB:Math.round(peak/1024**2)};await writeFile(join(output,`${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
   }else if(mode==='reads'||mode==='heartbeat-load'||mode.startsWith('analytics')){
    const cfg=loadConfig({DATABASE_URL:url,AWS_REGION:'ap-south-1',S3_BUCKET:'synthetic-private-bucket',SQS_QUEUE_URL:'https://sqs.ap-south-1.amazonaws.com/000000000000/synthetic',CORS_ORIGIN:'http://localhost:5190'}),app=Fastify();
    const session=registerEmailOtp(app,db,cfg,async()=>{throw new Error('Capacity tests must not send email')}),authenticate=withModulePermissions(db,session);
    if(mode.startsWith('analytics'))registerWorkspaceControls(app,db,async()=>({userId:f.adminId,roles:['SUPER_ADMIN']}));else{registerDocuments(app,db,{} as S3Client,cfg,authenticate);registerNotifications(app,db,authenticate);registerWorkspaceChanges(app,db,authenticate)}
    try{
     if(mode==='heartbeat-load'){
      const duration=Number(process.env.CAPACITY_DURATION_SECONDS??30),rate=Number(process.env.CAPACITY_HEARTBEAT_RPS??2000);
      if(!Number.isInteger(duration)||duration<10||duration>120||!Number.isInteger(rate)||rate<10||rate>5000)throw new Error('Invalid bounded heartbeat load settings');
      const origin=await app.listen({host:'127.0.0.1',port:0}),pending=new Set<Promise<void>>(),durations:number[]=[],statuses:Record<string,number>={};let dropped=0,sent=0;
      const begin=performance.now(),steps=duration*10;
      for(let step=0;step<steps;step++){
       const delay=begin+step*100-performance.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
       for(let n=0;n<Math.floor(rate/10);n++){
        if(pending.size>=500){dropped++;continue}const id=sent++%10000+1,t=performance.now();
        const task=(async()=>{try{const response=await fetch(`${origin}/v1/changes`,{headers:{cookie:`dochub_session=${String(id).padStart(43,'x')}`},signal:AbortSignal.timeout(5000)});await response.arrayBuffer();statuses[response.status]=(statuses[response.status]??0)+1}catch{statuses.network=(statuses.network??0)+1}finally{durations.push(performance.now()-t)}})();pending.add(task);void task.finally(()=>pending.delete(task));
       }
      }
      await Promise.all(pending);const elapsed=performance.now()-begin;durations.sort((a,b)=>a-b);
      const result={mode,students:f.students,syntheticActiveUsers:10000,targetRequestsPerSecond:rate,durationSeconds:duration,sent,dropped,statuses,elapsedMs:Math.round(elapsed),actualRequestsPerSecond:+(sent/(elapsed/1000)).toFixed(1),p95Ms:Math.round(durations[Math.floor(durations.length*.95)]!),p99Ms:Math.round(durations[Math.floor(durations.length*.99)]!),peakNodeRssMiB:Math.round(peak/1024**2),transport:'HTTP on loopback; generator and API in same process; no TLS/AWS/PDF traffic'};
      await writeFile(join(output,`${mode}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(dropped||Object.keys(statuses).some(status=>status!=='200'))process.exitCode=1;
     }else{
     const endpoints=mode.startsWith('analytics')?(mode==='analytics-inactive'?['/v1/admin/analytics?from=2019-01-01&to=2019-01-31','/v1/admin/analytics?from=2019-01-01&to=2019-01-31&inactivePage=2&materialsPage=2']:["/v1/admin/analytics","/v1/admin/analytics?materialsPage=2"]):['/v1/student/materials','/v1/student/catalogue','/v1/student/notifications/unread','/auth/session','/v1/changes'],measurements=[];const seenInactive=new Set<string>(),seenMaterials=new Set<string>();
     for(const endpoint of endpoints){
      const count=mode.startsWith('analytics')?1:200,concurrency=mode.startsWith('analytics')?1:20,durations:number[]=[],statuses:Record<string,number>={},errors:string[]=[];let next=0;const queryStart=queries,begin=performance.now();
      await Promise.all(Array.from({length:concurrency},async()=>{while(next<count){const n=++next,t=performance.now(),response=await app.inject({url:endpoint,headers:{cookie:`dochub_session=${String(n).padStart(43,'x')}`}});if(mode.startsWith('analytics')&&response.statusCode===200){const a=response.json();if(a.students!==f.students||a.engaged!==(mode==='analytics-inactive'?0:f.students)||a.inactiveCount!==(mode==='analytics-inactive'?f.students:0)||a.inactive.length>50||a.materialsCount!==f.materials||a.materials.length>50)throw new Error('Incorrect or unbounded analytics result');if(a.byCourse[0]?.count!==f.students||a.byPlan[0]?.count!==f.students||a.materials.some((d:any)=>d.opened<0||d.notOpened<0||d.opened+d.notOpened!==f.students))throw new Error('Incorrect aggregate audience counts');for(const row of a.inactive){if(seenInactive.has(row.id))throw new Error('Duplicate inactive page');seenInactive.add(row.id)}for(const row of a.materials){if(seenMaterials.has(row.id))throw new Error('Duplicate material page');seenMaterials.add(row.id)}if(mode==='analytics'&&endpoint.includes('materialsPage=2')&&a.materials.find((d:any)=>d.id===f.documentId)?.opened!==f.students)throw new Error('Material open count mismatch')}durations.push(performance.now()-t);statuses[response.statusCode]=(statuses[response.statusCode]??0)+1;if(response.statusCode!==200&&errors.length<2)errors.push(response.json().message?.slice(-1200))}}));
      if(Object.keys(statuses).some(status=>status!=='200'))process.exitCode=1;
      durations.sort((a,b)=>a-b);const elapsed=performance.now()-begin;await new Promise(resolve=>setTimeout(resolve,20));
      measurements.push({endpoint,requests:count,concurrency,statuses,errors,elapsedMs:Math.round(elapsed),requestsPerSecond:+(count/(elapsed/1000)).toFixed(1),p50Ms:Math.round(durations[Math.floor(count*.5)]!),p95Ms:Math.round(durations[Math.min(count-1,Math.floor(count*.95))]!),queries:queries-queryStart});
     }
     const result={mode,students:f.students,materials:f.materials,measurements,peakNodeRssMiB:Math.round(peak/1024**2),transport:'Fastify inject (no network/TLS)',cloudServices:'not exercised'};await writeFile(join(output,`${mode}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
     }
    }finally{await app.close()}
   }else throw new Error('Expected seed, reads, fanout or analytics');
  }catch(error){const report={mode,elapsedMs:Math.round(performance.now()-started),error:error instanceof Error?error.message.slice(-1200):String(error),queries,peakNodeRssMiB:Math.round(Math.max(peak,process.memoryUsage().rss)/1024**2)};await writeFile(join(output,`${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=1}finally{clearInterval(timer)}
 }
}finally{await db.$disconnect()}
