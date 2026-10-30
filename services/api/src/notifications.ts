import {scanNotificationAttachment} from './attachment-scan.js';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Prisma,type PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {assertRole,AuthError,type Principal} from './auth.js';
import {notificationAudienceCount,publishNotification} from './notification-delivery.js';
const uuid=z.string().uuid();
const target=z.object({courseIds:z.array(uuid).max(100).default([]),programmeIds:z.array(uuid).max(100).default([]),planIds:z.array(uuid).max(100).default([])}).strict().refine(v=>v.courseIds.length+v.programmeIds.length+v.planIds.length>0,'Select a course, programme or plan');
const attachment=z.object({name:z.string().trim().min(1).max(180),mimeType:z.string().max(150),base64:z.string().max(7_000_000)}).strict();
const compose=z.object({title:z.string().trim().min(2).max(240),body:z.string().trim().min(1).max(12000),target,attachments:z.array(attachment).max(3).default([]),requestId:uuid}).strict();
const page=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),kind:z.enum(['ALL','CUSTOM','REGULAR']).default('ALL'),q:z.string().trim().max(120).default(''),unread:z.enum(['true','false']).optional()});
const params=z.object({id:uuid});
const fileMeta={id:true,name:true,mimeType:true,size:true} as const;
const metadata={id:true,kind:true,title:true,body:true,createdAt:true,courseIds:true,programmeIds:true,planIds:true,sourceId:true,attachments:{select:fileMeta}} as const;
const adminMetadata={...metadata,deliveryJob:{select:{delivered:true,expectedRecipients:true,completedAt:true,lastError:true}}} as const;
function decodeFile(file:z.infer<typeof attachment>){
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)||file.base64.length%4!==0)throw new AuthError(422,'Invalid attachment encoding');
 const data=Buffer.from(file.base64,'base64');
 if(!data.length||data.length>5*1024*1024)throw new AuthError(413,'Each attachment must be between 1 byte and 5 MB');
 const extension=file.name.split('.').pop()?.toLowerCase();
 const types:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 if(!extension||!types[extension])throw new AuthError(422,'Attach PDF, PNG, JPG, TXT, CSV, DOCX or XLSX files');
 const signature=extension==='pdf'?data.subarray(0,5).toString()==='%PDF-':extension==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(extension)?data[0]===255&&data[1]===216:['docx','xlsx'].includes(extension)?data[0]===80&&data[1]===75:!data.includes(0);
 if(!signature)throw new AuthError(422,`${file.name}: file contents do not match the extension`);
 return {id:randomUUID(),name:file.name.replace(/[\r\n\\/]/g,'_'),mimeType:types[extension]!,size:data.length,data};
}
async function validateTarget(tx:Prisma.TransactionClient,t:z.infer<typeof target>){
 const [courses,programmes,plans]=await Promise.all([
  tx.academicCourse.findMany({where:{id:{in:t.courseIds},hidden:false,accessLocked:false,archivedAt:null}}),
  tx.academicProgramme.findMany({where:{id:{in:t.programmeIds},locked:true,hidden:false,accessLocked:false,archivedAt:null},include:{plans:true}}),
  tx.academicPlan.findMany({where:{id:{in:t.planIds},hidden:false,accessLocked:false,archivedAt:null}}),
 ]);
 if(courses.length!==new Set(t.courseIds).size||programmes.length!==new Set(t.programmeIds).size||plans.length!==new Set(t.planIds).size)throw new AuthError(422,'A selected audience is unavailable. Refresh your selections.');
 if(programmes.some(p=>t.courseIds.length&&!t.courseIds.includes(p.courseId))||plans.some(p=>t.courseIds.length&&!t.courseIds.includes(p.courseId))||plans.some(p=>programmes.length&&!programmes.some(g=>g.plans.some(link=>link.planId===p.id))))throw new AuthError(422,'Selected courses, programmes and plans do not match');
}
async function sendTransaction<T>(db:PrismaClient,work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
 for(let attempt=0;attempt<3;attempt++){
  try{return await db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});}
  catch(error){
   if(!(error instanceof Prisma.PrismaClientKnownRequestError)||!['P2034','P2002'].includes(error.code))throw error;
   if(attempt===2)throw new AuthError(409,'Concurrent notification change. Retry sending this message.');
  }
 }
 throw new Error('Notification transaction did not finish');
}
export function registerNotifications(app:FastifyInstance,db:PrismaClient,authenticate:(req:FastifyRequest)=>Promise<Principal>,scan:(data:Buffer)=>Promise<void>=scanNotificationAttachment){
 app.addHook('onSend',async(req,reply,payload)=>{if(req.url.includes('/notifications'))reply.header('Cache-Control','private, no-store');return payload;});
 const admin=async(req:FastifyRequest)=>{const p=await authenticate(req);assertRole(p,['SUPER_ADMIN','CONTENT_MANAGER']);return p;};
 const student=async(req:FastifyRequest)=>{const p=await authenticate(req);assertRole(p,['STUDENT']);return p;};
 const owner=(p:Principal)=>p.roles.includes('SUPER_ADMIN')?{}:{createdById:p.userId};
 app.post('/v1/admin/notifications/sync-publications',async req=>{
  const p=await admin(req);
  return sendTransaction(db,async tx=>{
   const documentIds=await tx.$queryRaw<Array<{id:string}>>`SELECT d.id FROM "Document" d WHERE d.state='PUBLISHED' AND NOT d.hidden AND NOT d.locked AND (${p.roles.includes('SUPER_ADMIN')} OR d."createdById"=${p.userId}::uuid) AND (d."folderId" IS NULL OR EXISTS(SELECT 1 FROM "DocumentFolder" f WHERE f.id=d."folderId" AND NOT f.hidden AND NOT f.locked)) AND NOT EXISTS(SELECT 1 FROM "Notification" n WHERE n.kind='MATERIAL' AND n."sourceId"=d.id) ORDER BY d."publishedAt" DESC,d.id LIMIT 51`;
   const sessionIds=await tx.$queryRaw<Array<{id:string}>>`SELECT s.id FROM "LiveSession" s WHERE s."publishedAt" IS NOT NULL AND s.status<>'DRAFT' AND (${p.roles.includes('SUPER_ADMIN')} OR s."createdById"=${p.userId}::uuid) AND NOT EXISTS(SELECT 1 FROM "Notification" n WHERE n.kind='SESSION' AND n."sourceId"=s.id) ORDER BY s."publishedAt" DESC,s.id LIMIT 51`;
   const documents=await tx.document.findMany({where:{id:{in:documentIds.map(d=>d.id)}},include:{grants:true,versions:{where:{state:'PUBLISHED'},orderBy:{number:'desc'},take:1}},orderBy:[{publishedAt:'desc'},{id:'asc'}]});
   const sessions=await tx.liveSession.findMany({where:{id:{in:sessionIds.map(s=>s.id)}},include:{plans:true},orderBy:[{publishedAt:'desc'},{id:'asc'}]});
   let created=0;
   for(const d of documents.slice(0,50)){
    const version=d.versions[0];if(!version)continue;
    await publishNotification(tx,{kind:'MATERIAL',title:`New material: ${d.title}`,body:`${d.title} is published. Open My learning to study this material.`,createdById:d.createdById,createdAt:d.publishedAt??undefined,eventKey:`material:${version.id}`,sourceId:d.id,courseIds:[d.courseId],programmeIds:[d.programmeId],planIds:d.grants.map(g=>g.planId),subjectId:d.subjectId});created++;
   }
   for(const s of sessions.slice(0,50)){
    await publishNotification(tx,{kind:'SESSION',title:`Session published: ${s.topic}`,body:`${s.topic}\nFaculty: ${s.facultyName}\nStarts: ${s.startAt.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST\nStatus: ${s.status}\nOpen My Schedule for details.`,createdById:s.createdById,createdAt:s.publishedAt??undefined,eventKey:`session:${s.id}:${Math.max(0,s.revision-1)}`,sourceId:s.id,courseIds:[s.courseId],programmeIds:[s.programmeId],planIds:s.plans.map(g=>g.planId),subjectId:s.subjectId});created++;
   }
   await tx.auditEvent.create({data:{actorId:p.userId,targetId:p.userId,action:'PUBLICATION_NOTIFICATIONS_RECOVERED',details:{created}}});
   return {created,hasMore:documents.length>50||sessions.length>50};
  });
 });
 app.post('/v1/admin/notifications/audience',async req=>{
  await admin(req);const t=target.parse(req.body);
  return db.$transaction(async tx=>{await validateTarget(tx,t);return {count:await notificationAudienceCount(tx,t)};});
 });
 app.post('/v1/admin/notifications',{bodyLimit:15*1024*1024},async(req,reply)=>{
  const p=await admin(req),input=compose.parse(req.body),files=input.attachments.map(decodeFile);
  if(files.reduce((sum,f)=>sum+f.size,0)>10*1024*1024)throw new AuthError(413,'Attachments must total 10 MB or less');
  for(const file of files)await scan(file.data);
  const result=await sendTransaction(db,async tx=>{
   const eventKey=`custom:${p.userId}:${input.requestId}`;
   const previous=await tx.notification.findUnique({where:{eventKey},include:{_count:{select:{recipients:true}},deliveryJob:true}});
   if(previous){const queued=!!previous.deliveryJob&&!previous.deliveryJob.completedAt;return {id:previous.id,recipients:queued?previous.deliveryJob?.expectedRecipients??previous._count.recipients:previous._count.recipients,queued};}
   await validateTarget(tx,input.target);const audience=await notificationAudienceCount(tx,input.target);
   if(!audience)throw new AuthError(422,'No active eligible students match this audience');
   const n=await tx.notification.create({data:{kind:'CUSTOM',title:input.title,body:input.body,createdById:p.userId,eventKey,...input.target,attachments:{create:files},deliveryJob:{create:{expectedRecipients:audience}}}});
   await tx.auditEvent.create({data:{actorId:p.userId,targetId:n.id,action:'NOTIFICATION_SENT',details:{recipients:audience,attachments:files.length}}});
   return {id:n.id,recipients:audience,queued:true};
  });
  return reply.code(201).send(result);
 });
 app.get('/v1/admin/notifications',async req=>{
  const p=await admin(req),q=page.parse(req.query);
  const where:Prisma.NotificationWhereInput={...owner(p),...(q.kind==='CUSTOM'?{kind:'CUSTOM'}:q.kind==='REGULAR'?{kind:{in:['MATERIAL','SESSION']}}:{}),...(q.q?{OR:[{title:{contains:q.q,mode:'insensitive'}},{body:{contains:q.q,mode:'insensitive'}}]}:{})};
  const [items,total]=await Promise.all([db.notification.findMany({where,select:{...adminMetadata,_count:{select:{recipients:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*30,take:30}),db.notification.count({where})]);
  const counts=await db.notificationRecipient.groupBy({by:['notificationId'],where:{notificationId:{in:items.map(n=>n.id)},readAt:{not:null}},_count:{_all:true}});
  const viewed=new Map(counts.map(row=>[row.notificationId,row._count._all]));
  return {items:items.map(({_count,...n})=>({...n,recipients:_count.recipients,viewers:viewed.get(n.id)??0})),total,nextPage:q.page*30<total?q.page+1:null};
 });
 app.get('/v1/admin/notifications/:id',async req=>{
  const p=await admin(req),{id}=params.parse(req.params);const q=page.parse(req.query);
  const n=await db.notification.findFirst({where:{id,...owner(p)},select:{...adminMetadata,_count:{select:{recipients:true}}}});
  if(!n)throw new AuthError(404,'Notification not found');
  const [viewers,people]=await Promise.all([db.notificationRecipient.count({where:{notificationId:id,readAt:{not:null}}}),db.notificationRecipient.findMany({where:{notificationId:id,readAt:{not:null}},select:{readAt:true,user:{select:{id:true,displayName:true,email:true}}},orderBy:[{readAt:'desc'},{userId:'asc'}],skip:(q.page-1)*30,take:30})]);
  return {...n,recipients:n._count.recipients,viewers,people,nextPage:q.page*30<viewers?q.page+1:null};
 });
 app.get('/v1/student/notifications/unread',async req=>{
  const p=await student(req);return {count:(await db.inboxState.findUnique({where:{userId:p.userId},select:{unreadCount:true}}))?.unreadCount??0};
 });
 app.get('/v1/student/notifications',async req=>{
  const p=await student(req),q=page.parse(req.query);
  const where:Prisma.NotificationRecipientWhereInput={userId:p.userId,...(q.unread==='true'?{readAt:null}:{}),notification:{...(q.kind==='CUSTOM'?{kind:'CUSTOM'}:q.kind==='REGULAR'?{kind:{in:['MATERIAL','SESSION']}}:{}),...(q.q?{OR:[{title:{contains:q.q,mode:'insensitive'}},{body:{contains:q.q,mode:'insensitive'}}]}:{})}};
  const [items,total]=await Promise.all([db.notificationRecipient.findMany({where,select:{readAt:true,notification:{select:metadata}},orderBy:[{notification:{createdAt:'desc'}},{notificationId:'desc'}],skip:(q.page-1)*30,take:30}),db.notificationRecipient.count({where})]);
  return {items:items.map(r=>({...r.notification,readAt:r.readAt})),total,nextPage:q.page*30<total?q.page+1:null};
 });
 app.post('/v1/student/notifications/:id/read',async req=>{
  const p=await student(req),{id}=params.parse(req.params);
  const r=await db.notificationRecipient.findUnique({where:{notificationId_userId:{notificationId:id,userId:p.userId}},select:{notification:{select:metadata}}});
  if(!r)throw new AuthError(404,'Notification not found');
  await db.notificationRecipient.updateMany({where:{notificationId:id,userId:p.userId,readAt:null},data:{readAt:new Date()}});
  return r.notification;
 });
 app.get('/v1/notifications/:id/attachments/:fileId',async(req,reply)=>{
  const p=await authenticate(req),{id,fileId}=z.object({id:uuid,fileId:uuid}).parse(req.params);
  const isAdmin=p.roles.some(r=>r==='SUPER_ADMIN'||r==='CONTENT_MANAGER');
  const n=await db.notification.findFirst({where:{id,...(isAdmin?owner(p):{recipients:{some:{userId:p.userId}}})},select:{id:true}});
  if(!n)throw new AuthError(404,'Attachment not found');
  const f=await db.notificationAttachment.findFirst({where:{id:fileId,notificationId:id}});if(!f)throw new AuthError(404,'Attachment not found');
  return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`).type(f.mimeType).send(Buffer.from(f.data));
 });
}
