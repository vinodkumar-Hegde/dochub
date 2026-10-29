import {publishNotification} from './notification-delivery.js';
import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, assertRole, type Principal } from './auth.js';
import type { Config } from './config.js';
import { previewPageKey } from './document-permissions.js';

const uuid=z.string().uuid();
const location=z.object({courseId:uuid,programmeId:uuid,subjectId:uuid}).strict();
const folderName=z.string().trim().min(1).max(100);
const folderColor=z.enum(['blue','violet','teal','amber','rose','slate']);
const folderCreate=location.extend({name:folderName,color:folderColor.default('blue')}).strict();
const folderUpdate=z.object({revision:z.number().int().nonnegative(),name:folderName.optional(),color:folderColor.optional(),hidden:z.boolean().optional(),locked:z.boolean().optional(),allowDownload:z.boolean().optional(),allowPrint:z.boolean().optional()}).strict();
const documentUpdate=z.object({revision:z.number().int().nonnegative(),folderId:uuid.nullable().optional(),hidden:z.boolean().optional(),locked:z.boolean().optional(),allowDownload:z.boolean().optional(),allowPrint:z.boolean().optional()}).strict();
const idParam=z.object({id:uuid});
const normalize=(s:string)=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');

/** Independent private page objects keep a copied document usable even if
 * the original PDF or its renditions are later removed. */
async function copyPreviewPages(s3:S3Client,bucket:string,fromVersion:string,toVersion:string,pageCount:number):Promise<string[]> {
  const keys:string[]=[];
  try {
    for(let page=1;page<=pageCount;page++){
      const from=previewPageKey(fromVersion,page),key=previewPageKey(toVersion,page);
      await s3.send(new CopyObjectCommand({Bucket:bucket,Key:key,CopySource:encodeURIComponent(`${bucket}/${from}`).replace(/%2F/g,'/'),ServerSideEncryption:'aws:kms'}));
      keys.push(key);
    }
    return keys;
  }catch(error){await removePreviewPages(s3,bucket,keys);throw error;}
}
async function removePreviewPages(s3:S3Client,bucket:string,keys:string[]):Promise<void>{
  for(const key of keys) await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>{});
}


async function approved(db:PrismaClient|Prisma.TransactionClient,scope:z.infer<typeof location>):Promise<void> {
  const p=await db.academicProgramme.findFirst({where:{id:scope.programmeId,courseId:scope.courseId,locked:true},include:{subjects:true}});
  if(!p?.subjects.some(s=>s.subjectId===scope.subjectId)) throw new AuthError(422,'Select a locked programme and one of its mapped subjects');
}
function assertAdmin(principal:Principal):void {assertRole(principal,['SUPER_ADMIN','CONTENT_MANAGER']);}

// Never return the underlying S3 objectKey. Copying uses S3 server-side encryption and
// a new, independently managed object per pasted PDF. A deleted original never affects copies.
export function registerFolders(app:FastifyInstance,db:PrismaClient,s3:S3Client,cfg:Config,authenticate:(req:FastifyRequest)=>Promise<Principal>):void {
  app.get('/v1/admin/folders',async req=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const scope=location.parse(req.query);
    return {items:await db.documentFolder.findMany({where:scope,orderBy:{name:'asc'},select:{id:true,courseId:true,programmeId:true,subjectId:true,name:true,color:true,hidden:true,locked:true,allowDownload:true,allowPrint:true,revision:true,createdAt:true,_count:{select:{documents:true}}}})};
  });
  app.post('/v1/admin/folders',async(req,reply)=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const input=folderCreate.parse(req.body);
    await approved(db,input);
    const folder=await db.documentFolder.create({data:{...input,nameKey:normalize(input.name),createdById:principal.userId}}).catch(error=>{
      if(error?.code==='P2002')throw new AuthError(409,'Folder already exists in this subject');throw error;
    });
    await db.auditEvent.create({data:{actorId:principal.userId,targetId:folder.id,action:'FOLDER_CREATED',details:{programmeId:input.programmeId,subjectId:input.subjectId}}});
    return reply.code(201).send({id:folder.id});
  });
  app.patch('/v1/admin/folders/:id',async req=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const {id}=idParam.parse(req.params),input=folderUpdate.parse(req.body);
    if(!Object.keys(input).some(k=>k!=='revision'))throw new AuthError(400,'No change supplied');
    return db.$transaction(async tx=>{
      const existing=await tx.documentFolder.findUnique({where:{id}});
      if(!existing)throw new AuthError(404,'Folder not found');
      if(existing.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Another manager owns this folder');
      if(existing.locked&&(input.name!==undefined||input.color!==undefined||input.hidden!==undefined||input.allowDownload!==undefined||input.allowPrint!==undefined)&&input.locked!==false)throw new AuthError(409,'Unlock the folder before editing permissions');
      const count=await tx.documentFolder.updateMany({where:{id,revision:input.revision},data:{...(input.name!==undefined?{name:input.name,nameKey:normalize(input.name)}:{}),...(input.color!==undefined?{color:input.color}:{}),...(input.hidden!==undefined?{hidden:input.hidden}:{}),...(input.locked!==undefined?{locked:input.locked}:{}),...(input.allowDownload!==undefined?{allowDownload:input.allowDownload}:{}),...(input.allowPrint!==undefined?{allowPrint:input.allowPrint}:{}),revision:{increment:1}}});
      if(count.count!==1)throw new AuthError(409,'Folder was changed elsewhere; refresh');
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'FOLDER_UPDATED',details:{hidden:input.hidden,locked:input.locked,allowDownload:input.allowDownload,allowPrint:input.allowPrint,nameChanged:input.name!==undefined,color:input.color}}});
      return {status:'saved'};
    });
  });
  // Organize or hide/lock a file. Locked files cannot be moved or hidden until unlocked.
  app.patch('/v1/admin/documents/:id/organize',async req=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const {id}=idParam.parse(req.params),input=documentUpdate.parse(req.body);
    return db.$transaction(async tx=>{
      const doc=await tx.document.findUnique({where:{id},include:{folder:true}});
      if(!doc||doc.state==='DELETED')throw new AuthError(404,'Document not found');
      if(doc.locked&&(input.folderId!==undefined||input.hidden!==undefined||input.allowDownload!==undefined||input.allowPrint!==undefined)&&input.locked!==false)throw new AuthError(409,'Unlock the file before changing its permissions');
      if(doc.folder?.locked&&(input.folderId!==undefined||input.hidden!==undefined||input.allowDownload!==undefined||input.allowPrint!==undefined))throw new AuthError(409,'Unlock the parent folder before changing file permissions');
      if(doc.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Not authorized to manage this file');
      if(input.folderId){
        const folder=await tx.documentFolder.findUnique({where:{id:input.folderId}});
        if(!folder||folder.courseId!==doc.courseId||folder.programmeId!==doc.programmeId||folder.subjectId!==doc.subjectId)throw new AuthError(422,'Folder must belong to the same subject and programme');
        if(folder.locked)throw new AuthError(409,'Destination folder is locked');
      }
      const result=await tx.document.updateMany({where:{id,revision:input.revision},data:{...(input.folderId!==undefined?{folderId:input.folderId}:{}),...(input.hidden!==undefined?{hidden:input.hidden}:{}),...(input.locked!==undefined?{locked:input.locked}:{}),...(input.allowDownload!==undefined?{allowDownload:input.allowDownload}:{}),...(input.allowPrint!==undefined?{allowPrint:input.allowPrint}:{}),revision:{increment:1}}});
      if(!result.count)throw new AuthError(409,'Document changed elsewhere; refresh');
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'DOCUMENT_ORGANIZED',details:{folderId:input.folderId,hidden:input.hidden,locked:input.locked,allowDownload:input.allowDownload,allowPrint:input.allowPrint}}});
      return {status:'saved'};
    });
  });
  // Paste/copy a published PDF into another folder within its existing subject.
  // The source object is copied, never shared, and cleaned up if DB commit fails.
  app.post('/v1/admin/documents/:id/copy',async(req,reply)=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const {id}=idParam.parse(req.params);
    const {folderId}=z.object({folderId:uuid.nullable()}).strict().parse(req.body);
    const doc=await db.document.findUnique({where:{id},include:{folder:true,grants:true,versions:{where:{state:'PUBLISHED'},orderBy:{number:'desc'},take:1}}});
    if(!doc||doc.state!=='PUBLISHED'||!doc.versions[0])throw new AuthError(409,'Only published PDFs can be copied');
    if(doc.locked||doc.folder?.locked)throw new AuthError(409,'Unlock the source before copying');
    if(doc.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Not authorized to copy this PDF');
    if(folderId){const target=await db.documentFolder.findUnique({where:{id:folderId}});
      if(!target||target.locked||target.courseId!==doc.courseId||target.programmeId!==doc.programmeId||target.subjectId!==doc.subjectId)throw new AuthError(422,'Destination must be an unlocked folder in the same subject');}
    await approved(db,doc);
    const old=doc.versions[0],documentId=randomUUID(),versionId=randomUUID();
    const key=`private/documents/${documentId}/${versionId}/original.pdf`;
    const source=encodeURIComponent(cfg.S3_BUCKET+'/'+old.objectKey).replace(/%2F/g,'/');
    const copied=await s3.send(new CopyObjectCommand({Bucket:cfg.S3_BUCKET,Key:key,CopySource:old.objectVersionId?`${source}?versionId=${encodeURIComponent(old.objectVersionId)}`:source,ServerSideEncryption:'aws:kms',MetadataDirective:'COPY'}));
    let previewKeys:string[]=[];
    try{
      if(old.previewReady && old.pageCount) previewKeys=await copyPreviewPages(s3,cfg.S3_BUCKET,old.id,versionId,old.pageCount);
      await db.$transaction(async tx=>{
        await approved(tx,doc);
        await tx.document.create({data:{id:documentId,title:doc.title,courseId:doc.courseId,programmeId:doc.programmeId,subjectId:doc.subjectId,folderId,hidden:doc.hidden||Boolean(doc.folder?.hidden),allowDownload:doc.allowDownload,allowPrint:doc.allowPrint,createdById:principal.userId,state:'PUBLISHED',publishedAt:new Date(),
          grants:{create:doc.grants.map(g=>({planId:g.planId}))},versions:{create:{id:versionId,number:1,objectKey:key,objectVersionId:copied.VersionId??null,sizeBytes:old.sizeBytes,contentSha256:old.contentSha256,pageCount:old.pageCount,previewReady:old.previewReady && Boolean(old.pageCount),state:'PUBLISHED'}}}});
        if(!doc.hidden&&!doc.folder?.hidden)await publishNotification(tx,{kind:'MATERIAL',title:`New material: ${doc.title}`,body:`${doc.title} is now available in My learning.`,createdById:principal.userId,eventKey:`material:${versionId}`,sourceId:documentId,courseIds:[doc.courseId],programmeIds:[doc.programmeId],planIds:doc.grants.map(g=>g.planId),subjectId:doc.subjectId});
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:documentId,action:'DOCUMENT_COPIED',details:{sourceId:id,folderId}}});
      });
    }catch(error){await removePreviewPages(s3,cfg.S3_BUCKET,previewKeys);await s3.send(new DeleteObjectCommand({Bucket:cfg.S3_BUCKET,Key:key,VersionId:copied.VersionId})).catch(()=>{});throw error;}
    return reply.code(201).send({id:documentId});
  });
  // Folder copy copies its published files as independent objects, limited to 20 per operation.
  // The destination folder is created only after all individual copies have succeeded.
  app.post('/v1/admin/folders/:id/copy',async(req,reply)=>{
    const principal=await authenticate(req);assertAdmin(principal);
    const {id}=idParam.parse(req.params);
    const {name}=z.object({name:folderName}).strict().parse(req.body);
    const source=await db.documentFolder.findUnique({where:{id},include:{documents:{where:{state:{not:'DELETED'}},include:{grants:true,versions:{where:{state:'PUBLISHED'},orderBy:{number:'desc'},take:1}}}}});
    if(!source)throw new AuthError(404,'Folder not found');
    if(source.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Another manager owns this folder');
    if(source.locked)throw new AuthError(409,'Unlock the folder before copying');
    if(source.documents.length>20)throw new AuthError(413,'Copy up to 20 published files per folder; move larger groups in smaller batches');
    if(source.documents.some(d=>d.state!=='PUBLISHED'||!d.versions[0]||d.locked))throw new AuthError(409,'Folder contains locked or unpublished documents; only published folders can be copied');
    await approved(db,source);
    const folderId=randomUUID(),copied:Array<{key:string;versionId?:string;documentId:string;pdfVersionId:string;previewKeys:string[];source:(typeof source.documents)[number]}>=[];
    try{
      for(const doc of source.documents){
        const old=doc.versions[0]!,documentId=randomUUID(),pdfVersionId=randomUUID();
        const key=`private/documents/${documentId}/${pdfVersionId}/original.pdf`;
        const from=encodeURIComponent(cfg.S3_BUCKET+'/'+old.objectKey).replace(/%2F/g,'/');
        const response=await s3.send(new CopyObjectCommand({Bucket:cfg.S3_BUCKET,Key:key,CopySource:old.objectVersionId?`${from}?versionId=${encodeURIComponent(old.objectVersionId)}`:from,ServerSideEncryption:'aws:kms'}));
        const entry={key,versionId:response.VersionId,documentId,pdfVersionId,previewKeys:[] as string[],source:doc};
        copied.push(entry);
        entry.previewKeys=old.previewReady && old.pageCount?await copyPreviewPages(s3,cfg.S3_BUCKET,old.id,pdfVersionId,old.pageCount):[];
      }
      await db.$transaction(async tx=>{
        await approved(tx,source);
        await tx.documentFolder.create({data:{id:folderId,courseId:source.courseId,programmeId:source.programmeId,subjectId:source.subjectId,name,nameKey:normalize(name),color:source.color,hidden:source.hidden,allowDownload:source.allowDownload,allowPrint:source.allowPrint,createdById:principal.userId}});
        for(const entry of copied){const old=entry.source.versions[0]!;
          await tx.document.create({data:{id:entry.documentId,title:entry.source.title,courseId:source.courseId,programmeId:source.programmeId,subjectId:source.subjectId,folderId,hidden:entry.source.hidden,allowDownload:entry.source.allowDownload,allowPrint:entry.source.allowPrint,createdById:principal.userId,state:'PUBLISHED',publishedAt:new Date(),
            grants:{create:entry.source.grants.map(g=>({planId:g.planId}))},versions:{create:{id:entry.pdfVersionId,number:1,objectKey:entry.key,objectVersionId:entry.versionId??null,sizeBytes:old.sizeBytes,contentSha256:old.contentSha256,pageCount:old.pageCount,previewReady:old.previewReady && Boolean(old.pageCount),state:'PUBLISHED'}}}});
          if(!source.hidden&&!entry.source.hidden)await publishNotification(tx,{kind:'MATERIAL',title:`New material: ${entry.source.title}`,body:`${entry.source.title} is now available in My learning.`,createdById:principal.userId,eventKey:`material:${entry.pdfVersionId}`,sourceId:entry.documentId,courseIds:[source.courseId],programmeIds:[source.programmeId],planIds:entry.source.grants.map(g=>g.planId),subjectId:source.subjectId});
        }
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:folderId,action:'FOLDER_COPIED',details:{sourceId:id,fileCount:copied.length}}});
      },{timeout:20_000});
    }catch(error){for(const entry of copied){await removePreviewPages(s3,cfg.S3_BUCKET,entry.previewKeys);await s3.send(new DeleteObjectCommand({Bucket:cfg.S3_BUCKET,Key:entry.key,VersionId:entry.versionId})).catch(()=>{});}throw error;}
    return reply.code(201).send({id:folderId,copied:copied.length});
  });
}
