import type {PrismaClient,Prisma} from '@prisma/client';import type {FastifyInstance,FastifyRequest} from 'fastify';import {z} from 'zod';import {AuthError,type Principal} from './auth.js';
export function registerGlobalSearch(app:FastifyInstance,db:PrismaClient,authenticate:(req:FastifyRequest)=>Promise<Principal>){
 app.get('/v1/search',async req=>{
  const p=await authenticate(req),{q}=z.object({q:z.string().trim().min(2).max(100)}).parse(req.query),student=!p.roles.some(r=>r==='SUPER_ADMIN'||r==='CONTENT_MANAGER')&&p.roles.includes('STUDENT');
  if(!student&&!p.roles.some(r=>r==='SUPER_ADMIN'||r==='CONTENT_MANAGER'))throw new AuthError(403,'Search is not available for this account');
  const employee=await db.employeeProfile.findUnique({where:{userId:p.userId}}),permissions=employee?await db.modulePermission.findMany({where:{userId:p.userId,canView:true}}):[];
  const can=(module:string)=>student||p.roles.includes('SUPER_ADMIN')||(employee?permissions.some(g=>g.module===module):['Analytics','Academic Mapping','Uploads','Sessions','Notifications'].includes(module));
  const now=new Date(),grants=student?await db.enrollment.findMany({where:{userId:p.userId,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}}):[];
  const live={hidden:false,accessLocked:false,archivedAt:null};
  const programmes=await db.academicProgramme.findMany({where:{locked:true,...live,course:live,...(student?{id:{in:grants.map(g=>g.programmeId)}}:{})},include:{plans:{include:{plan:true}},subjects:{include:{subject:true}}}});
  const valid=grants.filter(g=>programmes.some(pr=>pr.id===g.programmeId&&pr.courseId===g.courseId&&pr.plans.some(x=>x.planId===g.planId&&!x.plan.hidden&&!x.plan.accessLocked&&!x.plan.archivedAt)&&pr.subjects.some(x=>x.subjectId===g.subjectId&&!x.subject.hidden&&!x.subject.accessLocked&&!x.subject.archivedAt)));
  const docWhere:Prisma.DocumentWhereInput=student?{OR:valid.map(g=>({courseId:g.courseId,programmeId:g.programmeId,subjectId:g.subjectId,grants:{some:{planId:g.planId}}})),state:'PUBLISHED',hidden:false,locked:false,AND:[{OR:[{folderId:null},{folder:{hidden:false,locked:false}}]}]}:{};
  const sessionWhere:Prisma.LiveSessionWhereInput=student?{publishedAt:{not:null},status:{not:'DRAFT'},OR:valid.map(g=>({courseId:g.courseId,programmeId:g.programmeId,subjectId:g.subjectId,plans:{some:{planId:g.planId}}}))}:{};
  const [docs,sessions,users]=await Promise.all([
   can('Uploads')?db.document.findMany({where:{...docWhere,title:{contains:q,mode:'insensitive'},state:student?'PUBLISHED':{not:'DELETED'}},select:{id:true,title:true},take:6}):[],
   can('Sessions')?db.liveSession.findMany({where:{...sessionWhere,topic:{contains:q,mode:'insensitive'}},select:{id:true,topic:true,startAt:true},take:6}):[],
   !student&&can('Subscribers')?db.user.findMany({where:{roles:{some:{role:'STUDENT'}},OR:[{email:{contains:q,mode:'insensitive'}},{displayName:{contains:q,mode:'insensitive'}}]},select:{id:true,displayName:true,email:true},take:6}):[],
  ]);
  return {items:[...docs.map(d=>({id:d.id,title:d.title,kind:'material',module:'Uploads'})),...sessions.map(s=>({id:s.id,title:s.topic,kind:'session',module:'Sessions'})),...users.map(u=>({id:u.id,title:u.displayName||u.email,kind:'student',module:'Subscribers'})),...(can('Academic Mapping')?programmes.filter(pr=>(!student||valid.some(g=>g.programmeId===pr.id))&&pr.name.toLowerCase().includes(q.toLowerCase())).slice(0,6).map(pr=>({id:pr.id,title:pr.name,kind:'programme',module:student?'Learning':'Academic Mapping'})):[])]};
 });
}
