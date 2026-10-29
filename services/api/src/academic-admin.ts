import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, assertRole, type Principal } from './auth.js';
import { nameKey,normalizedName } from './academic-policy.js';

const uuid=z.string().uuid();
const kind=z.enum(['courses','plans','subjects','programmes','faculty']);
const param=z.object({kind,id:uuid}).strict();
const update=z.object({
  revision:z.number().int().nonnegative(),
  name:z.string().trim().min(2).max(120).optional(),
  hidden:z.boolean().optional(),
  accessLocked:z.boolean().optional(),
  archived:z.boolean().optional(),
}).strict().refine(v=>Object.keys(v).some(k=>k!=='revision'),{message:'Select a field to update'});
const facultyCreate=z.object({name:z.string().trim().min(2).max(120)}).strict();

/** All academic taxonomy state changes are revision-checked and audit-logged.\n * Archived records are not deleted. Restoration is Super Admin-only. */
export function registerAcademicAdministration(app:FastifyInstance,db:PrismaClient,authenticate:(r:FastifyRequest)=>Promise<Principal>):void {
  app.post('/v1/academic/faculty',async(req,reply)=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
    const {name:raw}=facultyCreate.parse(req.body);const name=normalizedName(raw);
    try {
      const faculty=await db.$transaction(async tx=>{
        const record=await tx.academicFaculty.create({data:{name,nameKey:nameKey(name)}});
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:record.id,action:'FACULTY_CREATED',details:{name}}});
        return record;
      });
      return reply.code(201).send({id:faculty.id,name:faculty.name});
    }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new AuthError(409,'Faculty already exists');throw error;}
  });

  app.patch('/v1/academic/manage/:kind/:id',async req=>{
    const principal=await authenticate(req);assertRole(principal,['SUPER_ADMIN']);
    const {kind:entity,id}=param.parse(req.params);
    const body=update.parse(req.body);
    try {
      return await db.$transaction(async tx=>{
        const current=entity==='courses'?await tx.academicCourse.findUnique({where:{id}})
          :entity==='plans'?await tx.academicPlan.findUnique({where:{id}})
          :entity==='subjects'?await tx.academicSubject.findUnique({where:{id}})
          :entity==='programmes'?await tx.academicProgramme.findUnique({where:{id}})
          :await tx.academicFaculty.findUnique({where:{id}});
        if(!current)throw new AuthError(404,'Academic record not found');
        if(current.revision!==body.revision)throw new AuthError(409,'Record changed elsewhere; reload and retry');
        const patch={
          ...(body.name!==undefined?{name:normalizedName(body.name),nameKey:nameKey(body.name)}:{}),
          ...(body.hidden!==undefined?{hidden:body.hidden}:{}),
          ...(body.accessLocked!==undefined?{accessLocked:body.accessLocked}:{}),
          ...(body.archived!==undefined?{archivedAt:body.archived?new Date():null}:{}),
          revision:{increment:1 as const},
        };
        const result=entity==='courses'?await tx.academicCourse.updateMany({where:{id,revision:body.revision},data:patch})
          :entity==='plans'?await tx.academicPlan.updateMany({where:{id,revision:body.revision},data:patch})
          :entity==='subjects'?await tx.academicSubject.updateMany({where:{id,revision:body.revision},data:patch})
          :entity==='programmes'?await tx.academicProgramme.updateMany({where:{id,revision:body.revision},data:patch})
          :await tx.academicFaculty.updateMany({where:{id,revision:body.revision},data:patch});
        if(result.count!==1)throw new AuthError(409,'Record changed elsewhere; reload and retry');
        if(entity==='faculty'&&body.name!==undefined){
          // Linked session snapshots also reflect faculty rename, including published sessions.
          await tx.liveSession.updateMany({where:{facultyId:id},data:{facultyName:normalizedName(body.name),revision:{increment:1}}});
        }
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,
          action:body.archived===true?'ACADEMIC_ARCHIVED':body.archived===false?'ACADEMIC_RESTORED':'ACADEMIC_UPDATED',
          details:{entity,revision:body.revision+1,changes:Object.keys(body).filter(x=>x!=='revision')},
        }});
        return {status:'saved',revision:body.revision+1};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError){
        if(error.code==='P2002')throw new AuthError(409,'An academic record with this name already exists');
        if(error.code==='P2034')throw new AuthError(409,'Concurrent update; reload and retry');
      }
      throw error;
    }
  });
}
