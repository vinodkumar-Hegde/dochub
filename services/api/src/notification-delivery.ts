import type {Prisma} from '@prisma/client';
export type NotificationTarget={courseIds:string[];programmeIds:string[];planIds:string[];subjectId?:string|null};
const live={hidden:false,accessLocked:false,archivedAt:null} as const;
/** Match one complete, currently active subscription, never pieces of different grants. */
export async function notificationAudience(tx:Prisma.TransactionClient,target:NotificationTarget,now=new Date()):Promise<string[]>{
 const grants=await tx.enrollment.findMany({where:{activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}],
  ...(target.courseIds.length?{courseId:{in:target.courseIds}}:{}),...(target.programmeIds.length?{programmeId:{in:target.programmeIds}}:{}),
  ...(target.planIds.length?{planId:{in:target.planIds}}:{}),...(target.subjectId?{subjectId:target.subjectId}:{}),
  user:{enabled:true,roles:{some:{role:'STUDENT'},every:{role:'STUDENT'}}},
 }});
 const [programmes,plans,subjects]=await Promise.all([
  tx.academicProgramme.findMany({where:{id:{in:grants.map(g=>g.programmeId)},locked:true,...live,course:live},include:{plans:true,subjects:true}}),
  tx.academicPlan.findMany({where:{id:{in:grants.map(g=>g.planId)},...live}}),
  tx.academicSubject.findMany({where:{id:{in:grants.map(g=>g.subjectId)},...live}}),
 ]);
 const byProgramme=new Map(programmes.map(p=>[p.id,p])),byPlan=new Map(plans.map(p=>[p.id,p])),subjectSet=new Set(subjects.map(s=>s.id));
 return [...new Set(grants.filter(g=>{
  const p=byProgramme.get(g.programmeId);
  return p?.courseId===g.courseId&&byPlan.get(g.planId)?.courseId===g.courseId&&subjectSet.has(g.subjectId)&&p.plans.some(link=>link.planId===g.planId)&&p.subjects.some(link=>link.subjectId===g.subjectId);
 }).map(g=>g.userId))];
}
export async function publishNotification(tx:Prisma.TransactionClient,input:NotificationTarget & {kind:'MATERIAL'|'SESSION';title:string;body:string;createdById:string;eventKey:string;sourceId:string;createdAt?:Date}){
 // Publication and notification commit together; retries never duplicate a message.
 const existing=await tx.notification.findUnique({where:{eventKey:input.eventKey},select:{id:true}});
 if(existing)return existing;
 const audience=await notificationAudience(tx,input);
 return tx.notification.create({data:{...input,recipients:{create:audience.map(userId=>({userId}))}},select:{id:true}});
}
