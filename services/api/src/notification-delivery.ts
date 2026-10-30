import {Prisma,type PrismaClient} from '@prisma/client';
export type NotificationTarget={courseIds:string[];programmeIds:string[];planIds:string[];subjectId?:string|null};
/** One complete, currently eligible subscription; no cross-grant entitlement mixing. */
function audienceQuery(target:NotificationTarget,now:Date,cursor?:string|null,limit?:number){
 return Prisma.sql`SELECT DISTINCT e."userId" FROM "Enrollment" e
 JOIN "User" u ON u.id=e."userId" AND u.enabled
 JOIN "AcademicProgramme" p ON p.id::text=e."programmeId" AND p."courseId"::text=e."courseId" AND p.locked AND NOT p.hidden AND NOT p."accessLocked" AND p."archivedAt" IS NULL
 JOIN "AcademicCourse" c ON c.id=p."courseId" AND NOT c.hidden AND NOT c."accessLocked" AND c."archivedAt" IS NULL
 JOIN "ProgrammePlan" pp ON pp."programmeId"=p.id AND pp."planId"::text=e."planId"
 JOIN "AcademicPlan" ap ON ap.id=pp."planId" AND ap."courseId"=p."courseId" AND NOT ap.hidden AND NOT ap."accessLocked" AND ap."archivedAt" IS NULL
 JOIN "ProgrammeSubject" ps ON ps."programmeId"=p.id AND ps."subjectId"::text=e."subjectId"
 JOIN "AcademicSubject" s ON s.id=ps."subjectId" AND NOT s.hidden AND NOT s."accessLocked" AND s."archivedAt" IS NULL
 WHERE e."activeFrom"<=${now} AND (e."validUntil" IS NULL OR e."validUntil">${now})
 AND EXISTS(SELECT 1 FROM "UserProfile" r WHERE r."userId"=u.id AND r.role='STUDENT')
 AND NOT EXISTS(SELECT 1 FROM "UserProfile" r WHERE r."userId"=u.id AND r.role<>'STUDENT')
 AND (${target.courseIds.length===0} OR e."courseId"=ANY(${target.courseIds}::text[]))
 AND (${target.programmeIds.length===0} OR e."programmeId"=ANY(${target.programmeIds}::text[]))
 AND (${target.planIds.length===0} OR e."planId"=ANY(${target.planIds}::text[]))
 AND (${target.subjectId??null}::text IS NULL OR e."subjectId"=${target.subjectId??null})
 AND (${cursor??null}::uuid IS NULL OR e."userId">${cursor??null}::uuid)
 ${limit===undefined?Prisma.empty:Prisma.sql`ORDER BY e."userId" LIMIT ${limit}`}`;
}
export async function notificationAudienceCount(tx:Prisma.TransactionClient,target:NotificationTarget){
 const [row]=await tx.$queryRaw<Array<{count:number}>>(Prisma.sql`SELECT COUNT(*)::int count FROM (${audienceQuery(target,new Date())}) a`);return row!.count;
}
export async function publishNotification(tx:Prisma.TransactionClient,input:NotificationTarget & {kind:'MATERIAL'|'SESSION';title:string;body:string;createdById:string;eventKey:string;sourceId:string;createdAt?:Date}){
 const existing=await tx.notification.findUnique({where:{eventKey:input.eventKey},select:{id:true}});if(existing)return existing;
 // Persist the event and durable job atomically; never expand the audience here.
 return tx.notification.create({data:{...input,deliveryJob:{create:{}}},select:{id:true}});
}
/** Claim one short batch. Independent workers safely skip another worker's lock. */
export async function deliverNotificationBatch(db:PrismaClient,batchSize=1000):Promise<boolean>{
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error('Invalid delivery batch size');
 let claimed:string|undefined,claimedCursor:string|null=null;
 try{return await db.$transaction(async tx=>{
  const [job]=await tx.$queryRaw<Array<{notificationId:string;cursor:string|null}>>`SELECT "notificationId",cursor FROM "NotificationDeliveryJob" WHERE "completedAt" IS NULL AND "nextAttemptAt"<=clock_timestamp() ORDER BY "createdAt","notificationId" FOR UPDATE SKIP LOCKED LIMIT 1`;
  if(!job)return false;claimed=job.notificationId;claimedCursor=job.cursor;
  const n=await tx.notification.findUniqueOrThrow({where:{id:job.notificationId},select:{courseIds:true,programmeIds:true,planIds:true,subjectId:true}});
  const audience=await tx.$queryRaw<Array<{userId:string}>>(audienceQuery({...n,subjectId:n.subjectId??undefined},new Date(),job.cursor,batchSize));
  const inserted=audience.length?await tx.notificationRecipient.createMany({data:audience.map(({userId})=>({notificationId:job.notificationId,userId})),skipDuplicates:true}):{count:0};
  await tx.notificationDeliveryJob.update({where:{notificationId:job.notificationId},data:{cursor:audience.at(-1)?.userId??job.cursor,delivered:{increment:inserted.count},completedAt:audience.length<batchSize?new Date():null,lastError:null}});
  return true;
 },{timeout:15000})}catch(error){
  if(claimed)await db.notificationDeliveryJob.updateMany({where:{notificationId:claimed,completedAt:null,cursor:claimedCursor},data:{attempts:{increment:1},nextAttemptAt:new Date(Date.now()+30000),lastError:'Delivery failed; inspect worker logs. Retrying automatically.'}});
  throw error;
 }
}
