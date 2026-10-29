import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {Prisma,PrismaClient} from '@prisma/client';
import type {S3Client} from '@aws-sdk/client-s3';
import {registerDocuments} from '../src/documents.js';
import {publishDocument,publishRequestedVersion} from '../src/document-publication.js';
import {loadConfig} from '../src/config.js';

const db=new PrismaClient();
async function fixture(tx:Prisma.TransactionClient){
 const id=randomUUID();
 const user=await tx.user.create({data:{identitySub:`pdf-test-${id}`,roles:{create:{role:'CONTENT_MANAGER'}}}});
 const course=await tx.academicCourse.create({data:{name:`Test ${id}`,nameKey:id,code:id}});
 const subject=await tx.academicSubject.create({data:{name:`Test ${id}`,nameKey:id}});
 const plan=await tx.academicPlan.create({data:{courseId:course.id,name:`Test ${id}`,nameKey:id}});
 const programme=await tx.academicProgramme.create({data:{courseId:course.id,name:`Test ${id}`,nameKey:id,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
 const document=await tx.document.create({data:{title:'Isolated publication test',courseId:course.id,programmeId:programme.id,subjectId:subject.id,createdById:user.id,state:'PROCESSING',grants:{create:{planId:plan.id}}}});
 const version=await tx.documentVersion.create({data:{documentId:document.id,number:1,objectKey:`test/${id}`,sizeBytes:1n,state:'PROCESSING'}});
 const principal={userId:user.id,roles:['CONTENT_MANAGER' as const]};
 const scopedDb={$transaction:async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx)} as unknown as PrismaClient;
 return {user,document,version,programme,plan,principal,scopedDb};
}
const rollback=new Error('rollback test fixtures');
test('local PostgreSQL publication integration (all fixtures rolled back)',async t=>{
 const url=new URL(process.env.DATABASE_URL!);
 assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname),'Integration tests are local-only');
 try{
  await db.$transaction(async tx=>{
   await t.test('intent API persists/cancels, rejects stale versions and blocks foreign owners',async()=>{
    const f=await fixture(tx);let principal=f.principal;
    const app=Fastify();registerDocuments(app,{...f.scopedDb,document:tx.document} as unknown as PrismaClient,{} as S3Client,loadConfig(),async()=>principal);
    try{
     const url=`/v1/documents/${f.document.id}/publication-intent`;
     let response=await app.inject({method:'PUT',url,payload:{versionId:f.version.id,enabled:true}});assert.equal(response.statusCode,200,response.body);
     assert.equal((await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}})).publishRequestedById,f.user.id);
     response=await app.inject({method:'PUT',url,payload:{versionId:f.version.id,enabled:false}});assert.equal(response.statusCode,200);
     assert.equal((await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}})).publishRequestedById,null);
     response=await app.inject({method:'PUT',url,payload:{versionId:randomUUID(),enabled:true}});assert.equal(response.statusCode,409);
     principal={userId:randomUUID(),roles:['CONTENT_MANAGER']};
     response=await app.inject({method:'PUT',url,payload:{versionId:f.version.id,enabled:true}});assert.equal(response.statusCode,403);
    }finally{await app.close();}
   });
   await t.test('completion publishes once, clears intent and emits one audit event',async()=>{
    const f=await fixture(tx);
    await tx.documentVersion.update({where:{id:f.version.id},data:{state:'READY',previewReady:true,pageCount:25,publishRequestedById:f.user.id}});
    await publishRequestedVersion(f.scopedDb,f.version.id);await publishRequestedVersion(f.scopedDb,f.version.id);
    assert.equal((await tx.document.findUniqueOrThrow({where:{id:f.document.id}})).state,'PUBLISHED');
    const result=await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}});assert.equal(result.state,'PUBLISHED');assert.equal(result.publishRequestedById,null);
    assert.equal(await tx.auditEvent.count({where:{targetId:f.document.id,action:'PUBLISHED'}}),1);
   });
   await t.test('incomplete pages cannot publish',async()=>{
    const f=await fixture(tx);
    await tx.documentVersion.update({where:{id:f.version.id},data:{state:'READY',pageCount:25,publishRequestedById:f.user.id}});
    await publishRequestedVersion(f.scopedDb,f.version.id);
    await assert.rejects(()=>publishDocument(tx,f.document.id,f.principal),/not ready to publish/);
    assert.equal((await tx.document.findUniqueOrThrow({where:{id:f.document.id}})).state,'PROCESSING');
   });
   await t.test('failed and quarantined versions are never auto-published',async()=>{
    for(const state of ['FAILED','QUARANTINED'] as const){const f=await fixture(tx);
     await tx.documentVersion.update({where:{id:f.version.id},data:{state,previewReady:true,pageCount:1,publishRequestedById:f.user.id}});
     await publishRequestedVersion(f.scopedDb,f.version.id);
     assert.equal((await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}})).state,state);
    }
   });
   await t.test('revocation, file locks and changed mappings pause automatic publication',async()=>{
    for(const condition of ['revoked','role','locked','mapping']){
     const f=await fixture(tx);
     await tx.documentVersion.update({where:{id:f.version.id},data:{state:'READY',previewReady:true,pageCount:1,publishRequestedById:f.user.id}});
     if(condition==='revoked')await tx.user.update({where:{id:f.user.id},data:{enabled:false}});
     if(condition==='role')await tx.userProfile.deleteMany({where:{userId:f.user.id}});
     if(condition==='locked')await tx.document.update({where:{id:f.document.id},data:{locked:true}});
     if(condition==='mapping')await tx.academicProgramme.update({where:{id:f.programme.id},data:{locked:false}});
     await publishRequestedVersion(f.scopedDb,f.version.id);
     const result=await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}});assert.equal(result.state,'READY');assert.equal(result.publishRequestedById,null);assert.ok(result.publicationFailure);
    }
   });
   await t.test('an older requested replacement cannot replace a newer version',async()=>{
    const f=await fixture(tx);
    await tx.document.update({where:{id:f.document.id},data:{state:'PUBLISHED'}});
    await tx.documentVersion.update({where:{id:f.version.id},data:{state:'READY',previewReady:true,pageCount:1,publishRequestedById:f.user.id}});
    const newer=await tx.documentVersion.create({data:{documentId:f.document.id,number:2,objectKey:`test/${randomUUID()}`,sizeBytes:1n,state:'PROCESSING'}});
    await publishRequestedVersion(f.scopedDb,f.version.id);
    assert.equal((await tx.documentVersion.findUniqueOrThrow({where:{id:f.version.id}})).state,'READY');
    assert.equal((await tx.documentVersion.findUniqueOrThrow({where:{id:newer.id}})).state,'PROCESSING');
    assert.equal((await tx.document.findUniqueOrThrow({where:{id:f.document.id}})).state,'PUBLISHED');
   });
   await t.test('CDN grant issuance requires a live exact student entitlement and never exposes an original PDF',async()=>{
    const f=await fixture(tx);
    await tx.document.update({where:{id:f.document.id},data:{state:'PUBLISHED'}});
    await tx.documentVersion.update({where:{id:f.version.id},data:{state:'PUBLISHED',previewReady:true,pageCount:25}});
    const localDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
    const dir=await fs.mkdtemp(join(tmpdir(),'docusend-signing-test-'));
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    const path=join(dir,'key.pem');await fs.writeFile(path,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    const app=Fastify();
    registerDocuments(app,localDb,{} as S3Client,{...loadConfig(),PREVIEW_CDN_ORIGIN:'https://cdn.example.com',PREVIEW_CDN_KEY_PAIR_ID:'test-key',PREVIEW_CDN_PRIVATE_KEY_FILE:path},async()=>({userId:f.user.id,roles:['STUDENT']}));
    try{
     const url=`/v1/documents/${f.document.id}/read`;
     let response=await app.inject({method:'GET',url});assert.equal(response.statusCode,403);
     await tx.enrollment.create({data:{userId:f.user.id,courseId:f.document.courseId,programmeId:f.document.programmeId,subjectId:f.document.subjectId,planId:f.plan.id}});
     response=await app.inject({method:'GET',url});assert.equal(response.statusCode,200,response.body);
     const result=response.json();assert.equal(result.mode,'pages');assert.equal(result.url,undefined);assert.ok(!response.body.includes('original.pdf'));
     assert.ok(result.delivery.baseUrl.endsWith(`/private/previews/${f.version.id}/`));assert.equal(response.headers['cache-control'],'private, no-store');
     await tx.enrollment.updateMany({where:{userId:f.user.id},data:{validUntil:new Date(0)}});
     response=await app.inject({method:'GET',url});assert.equal(response.statusCode,403);
    }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
   });
   throw rollback;
  },{timeout:30000});
 }catch(error){if(error!==rollback)throw error;}finally{await db.$disconnect();}
});
