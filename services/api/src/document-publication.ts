import {publishNotification} from './notification-delivery.js';
import {Prisma, type PrismaClient} from '@prisma/client';
import {AuthError,assertRole,type Principal} from './auth.js';
import {isTaxonomyAvailable} from './academic-lifecycle-policy.js';
import {validUploadMapping} from './documents-policy.js';
import {publishablePreview} from './pdf-preview-job-policy.js';

/** Retry transaction conflicts without duplicating an audit or publication. */
export async function publicationTransaction<T>(db:PrismaClient,work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
  for(let attempt=0;attempt<3;attempt++){
    try{return await db.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
    catch(error){
      if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034')throw error;
      if(attempt===2)throw new AuthError(409,'Publication changed concurrently. Refresh and try again.');
    }
  }
  throw new Error('Publication transaction did not complete');
}

export async function assertPublicationAllowed(tx:Prisma.TransactionClient,id:string,principal:Principal){
  assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);
  if(!principal.roles.includes('SUPER_ADMIN')){const employee=await tx.employeeProfile.findUnique({where:{userId:principal.userId}});if(employee&&!await tx.modulePermission.findFirst({where:{userId:principal.userId,module:'Uploads',canManage:true}}))throw new AuthError(403,'Manage permission for materials has been revoked');}
  const document=await tx.document.findUnique({where:{id},include:{grants:true,folder:true}});
  if(!document||document.state==='DELETED')throw new AuthError(404,'Document not found');
  if(document.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Not authorized to publish this document');
  if(document.locked||document.folder?.locked)throw new AuthError(409,'Unlock the file and folder before publishing');
  const approved=await tx.academicProgramme.findUnique({where:{id:document.programmeId},include:{plans:true,subjects:true,course:true}});
  if(!isTaxonomyAvailable(approved)||!isTaxonomyAvailable(approved?.course)||!isTaxonomyAvailable(await tx.academicSubject.findUnique({where:{id:document.subjectId}})))throw new AuthError(423,'Academic content unavailable');
  if(!validUploadMapping(approved,{courseId:document.courseId,programmeId:document.programmeId,subjectId:document.subjectId,planIds:document.grants.map(g=>g.planId)}))throw new AuthError(409,'Programme mapping is no longer approved');
  return document;
}

/** Manual and deferred publication share the same transactional gate. */
export async function publishDocument(tx:Prisma.TransactionClient,id:string,principal:Principal,expectedVersionId?:string){
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
  const document=await assertPublicationAllowed(tx,id,principal);
  const latest=await tx.documentVersion.findFirst({where:{documentId:id,state:{not:'DELETED'}},orderBy:{number:'desc'}});
  if(expectedVersionId&&latest?.id!==expectedVersionId)throw new AuthError(409,'A newer PDF version exists. Review it before publishing.');
  if(latest?.state==='PUBLISHED')return;
  if(!latest||!publishablePreview(latest.state,latest.previewReady,latest.pageCount))throw new AuthError(409,'This PDF is not ready to publish yet. Choose Publish when ready, or wait until its status shows Ready to publish.');
  await tx.document.update({where:{id},data:{state:'PUBLISHED',publishedAt:new Date()}});
  await tx.documentVersion.update({where:{id:latest.id},data:{state:'PUBLISHED',publishRequestedById:null,publicationFailure:null}});
  if(!document.hidden&&!document.folder?.hidden)await publishNotification(tx,{kind:'MATERIAL',title:`New material: ${document.title}`,body:`${document.title} is now published. Open My learning to study the new material.`,createdById:principal.userId,eventKey:`material:${latest.id}`,sourceId:id,courseIds:[document.courseId],programmeIds:[document.programmeId],planIds:document.grants.map(g=>g.planId),subjectId:document.subjectId});
  await tx.auditEvent.create({data:{actorId:principal.userId,action:'PUBLISHED',targetId:id,details:{versionId:latest.id,automatic:Boolean(expectedVersionId)}}});
}

/** Re-read requester roles; a revoked manager must not publish later. Failure
 * never reruns a completed PDF render or changes an existing published version. */
export async function publishRequestedVersion(db:PrismaClient,versionId:string):Promise<void>{
  let attemptedRevision:number|undefined;
  try {
    await publicationTransaction(db,async tx=>{
      const version=await tx.documentVersion.findUnique({where:{id:versionId}});
      if(!version?.publishRequestedById||version.state!=='READY'||!version.previewReady)return;
      attemptedRevision=version.publicationRequestRevision;
      const requester=await tx.user.findUnique({where:{id:version.publishRequestedById},include:{roles:true}});
      if(!requester?.enabled)throw new AuthError(403,'The publication requester is no longer authorized');
      await publishDocument(tx,version.documentId,{userId:requester.id,roles:requester.roles.map(r=>r.role)},version.id);
    });
  }catch(error){
    if(!(error instanceof AuthError)||attemptedRevision===undefined||error.message==='Publication changed concurrently. Refresh and try again.')throw error;
    await db.$transaction(async tx=>{
      const changed=await tx.documentVersion.updateMany({where:{id:versionId,state:'READY',publishRequestedById:{not:null},publicationRequestRevision:attemptedRevision},data:{publishRequestedById:null,publicationFailure:error.message}});
      if(changed.count){const version=await tx.documentVersion.findUniqueOrThrow({where:{id:versionId}});await tx.auditEvent.create({data:{targetId:version.documentId,action:'AUTO_PUBLICATION_BLOCKED',details:{versionId,reason:error.message}}});}
    });
  }
}
