import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { awsClients } from './aws.js';
import { z } from 'zod';
import { assertWorkerPrerequisites } from './worker-prerequisites.js';
import { createPrivatePagePreviews } from './document-preview-render.js';
import {previewJob} from './pdf-preview-job-policy.js';

// Refuse SQS polling if malware scanning or PDF validation is not operational.
await assertWorkerPrerequisites();
const cfg = loadConfig();
const db = new PrismaClient();
const { s3, sqs } = awsClients(cfg);
// Use the same SDK credential chain as the actual S3/SQS worker, not only the AWS CLI.
await Promise.all([db.$queryRaw`SELECT 1`, s3.config.credentials()]);
console.info('PDF worker prerequisites, database and AWS SDK credentials verified');
const eventSchema = z.object({ id: z.string().uuid(), topic: z.literal('PDF_PROCESS'), versionId: z.string().uuid() });

async function execTool(command: string, args: string[], timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', chunk => { out += String(chunk).slice(0, 100000); });
    proc.stderr.on('data', chunk => { err += String(chunk).slice(0, 10000); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${command} failed (${code}): ${err.slice(0, 300)}`)); });
  });
}

type ProtectedPdfVersion = {
  objectKey:string; objectVersionId:string|null; sizeBytes:bigint; pageCount:number|null;
};
/** One authoritative scan, validation and bounded render path for queued and
 * exceptional repair jobs. Never called from any HTTP document-open request. */
async function verifyAndRenderPrivatePages(version:ProtectedPdfVersion,dir:string,versionId:string):Promise<number>{
  const path=join(dir,'input.pdf');
  const response=await s3.send(new GetObjectCommand({Bucket:cfg.S3_BUCKET,Key:version.objectKey,VersionId:version.objectVersionId??undefined}));
  if(!response.Body)throw new Error('Object body missing');
  await pipeline(response.Body as NodeJS.ReadableStream,createWriteStream(path,{flags:'wx',mode:0o600}));
  const stat=await fs.stat(path);
  if(BigInt(stat.size)!==version.sizeBytes)throw new Error('PDF size mismatch');
  const fd=await fs.open(path,'r');const header=Buffer.alloc(5);
  try{await fd.read(header,0,5,0);}finally{await fd.close();}
  if(header.toString('ascii')!=='%PDF-')throw new Error('Invalid PDF signature');
  await execTool('clamscan',['--no-summary','--max-filesize=0','--max-scansize=0',path],20*60*1000);
  const info=await execTool('pdfinfo',[path]);
  if(/^Encrypted:\s*yes\b/im.test(info))throw new Error('Password-protected PDF files are not supported');
  const pages=Number(/^Pages:\s*(\d+)$/m.exec(info)?.[1]);
  if(!Number.isSafeInteger(pages)||pages<1)throw new Error('Could not validate PDF pages');
  if(version.pageCount!==null&&version.pageCount!==pages)throw new Error('Verified PDF page count changed');
  await createPrivatePagePreviews(s3,cfg.S3_BUCKET,path,dir,versionId,pages);
  return pages;
}

/** Reconcile historic published/ready versions with missing secure page images.
 * Preserve publication status and use an atomic DB lease to prevent concurrent
 * repairs across multiple workers. New uploads use the ordinary SQS flow. */
async function repairMissingPreviews(versionId:string):Promise<'complete'|'busy'>{
  const prior=await db.documentVersion.findUnique({where:{id:versionId}});
  if(!prior||prior.previewReady)return 'complete';
  if(previewJob(prior.state,prior.previewReady,prior.processingAttempt)!=='repair')return 'complete';
  const now=new Date();
  const claimed=await db.documentVersion.updateMany({
    where:{id:versionId,state:prior.state,previewReady:false,processingAttempt:{lt:5},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},
    data:{leaseUntil:new Date(Date.now()+30*60_000),processingAttempt:{increment:1}},
  });
  if(!claimed.count)return 'busy';
  const version=await db.documentVersion.findUniqueOrThrow({where:{id:versionId}});
  const heartbeat=setInterval(()=>{
    void db.documentVersion.updateMany({where:{id:versionId,state:prior.state,previewReady:false},data:{leaseUntil:new Date(Date.now()+30*60_000)}})
      .catch(error=>console.error('PDF preview repair heartbeat failed',error));
  },60_000);
  let dir:string|undefined;
  try{
    dir=await fs.mkdtemp(join(tmpdir(),'docusend-preview-repair-'));
    const pages=await verifyAndRenderPrivatePages(version,dir,versionId);
    const result=await db.documentVersion.updateMany({
      where:{id:versionId,state:prior.state,previewReady:false},
      data:{pageCount:pages,previewReady:true,leaseUntil:null,failureReason:null},
    });
    if(result.count!==1)throw new Error('PDF preview repair state changed');
    await db.auditEvent.create({data:{targetId:version.documentId,action:'PDF_PREVIEWS_REPAIRED',details:{versionId,pages}}});
    console.info(`PDF preview repair completed: ${pages} protected pages`);
    return 'complete';
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown preview repair failure';
    const malware=message.includes('clamscan failed (1)');
    await db.$transaction(async tx=>{
      await tx.documentVersion.updateMany({where:{id:versionId,state:prior.state,previewReady:false},data:{
        ...(malware?{state:'QUARANTINED' as const}:{}),leaseUntil:null,
        failureReason:malware?'Malware detected; file quarantined':message.slice(0,500),
      }});
      await tx.auditEvent.create({data:{targetId:version.documentId,action:malware?'PDF_QUARANTINED':'PDF_PREVIEW_REPAIR_FAILED',details:{versionId,attempt:version.processingAttempt,error:malware?'Malware detected':message.slice(0,250)}}});
    });
    if(malware)return 'complete';
    throw error;
  }finally{
    clearInterval(heartbeat);
    if(dir)await fs.rm(dir,{recursive:true,force:true});
  }
}

async function processVersion(versionId: string, receiptHandle: string): Promise<'complete' | 'busy'> {
  const prior = await db.documentVersion.findUnique({ where: { id: versionId } });
  if (!prior) return 'complete';
  const mode=previewJob(prior.state,prior.previewReady,prior.processingAttempt);
  if(mode==='skip')return 'complete';
  if(mode==='repair')return repairMissingPreviews(versionId);
  if(mode==='terminal'){
    if(prior.state==='FAILED')throw new Error('PDF processing attempts exhausted; retaining SQS message for dead-letter delivery');
    console.warn(`Skipping ineligible preview job (state=${prior.state})`);
    return 'complete';
  }
  const now = new Date();
  const leaseUntil = new Date(Date.now() + 30 * 60 * 1000);
  // Atomic lease: duplicate queue deliveries do not perform concurrent processing.
  const acquired = await db.documentVersion.updateMany({
    where: { id: versionId, OR: [{ state: 'QUEUED' }, { state: 'PROCESSING', leaseUntil: { lt: now } }] },
    data: { state: 'PROCESSING', leaseUntil, processingAttempt: { increment: 1 } },
  });
  if (!acquired.count) return 'busy';
  const version = await db.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
  await db.document.updateMany({ where: { id: version.documentId, state: { notIn: ['PUBLISHED', 'DELETED'] } }, data: { state: 'PROCESSING' } });
  // Renew both the database lease and SQS invisibility while a large PDF is being processed.
  const heartbeat = setInterval(() => {
    void Promise.all([
      db.documentVersion.updateMany({ where: { id: versionId, state: 'PROCESSING' }, data: { leaseUntil: new Date(Date.now() + 30 * 60 * 1000) } }),
      sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: cfg.SQS_QUEUE_URL, ReceiptHandle: receiptHandle, VisibilityTimeout: 1800 })),
    ]).catch(error => console.error('PDF processing heartbeat failed', error));
  }, 60_000);
  let dir: string | undefined;
  try {
    dir = await fs.mkdtemp(join(tmpdir(), 'docusend-pdf-'));
    const pages = await verifyAndRenderPrivatePages(version, dir, versionId);
    await db.$transaction(async tx => {
      const updated = await tx.documentVersion.updateMany({ where: { id: versionId, state: 'PROCESSING' }, data: { state: 'READY', pageCount: pages, previewReady: true, leaseUntil: null, failureReason: null } });
      if (!updated.count) throw new Error('Document processing state changed');
      await tx.document.updateMany({ where: { id: version.documentId, state: { notIn: ['PUBLISHED','DELETED'] } }, data: { state: 'READY' } });
      await tx.auditEvent.create({ data: { action: 'PDF_PROCESSING_SUCCEEDED', targetId: version.documentId, details: { versionId, pages } } });
    });
    return 'complete';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error';
    await db.$transaction(async tx => {
      const malware = message.includes('clamscan failed (1)');
      const terminal = version.processingAttempt >= 5;
      const nextState = malware ? 'QUARANTINED' : terminal ? 'FAILED' : 'QUEUED';
      await tx.documentVersion.updateMany({ where: { id: versionId, state: 'PROCESSING' }, data: { state: nextState, leaseUntil: null, failureReason: malware ? 'Malware detected; file quarantined' : message.slice(0, 500) } });
      await tx.document.updateMany({ where: { id: version.documentId, state: { notIn: ['PUBLISHED','DELETED'] } }, data: { state: nextState } });
      await tx.auditEvent.create({ data: { action: malware ? 'PDF_QUARANTINED' : terminal ? 'PDF_PROCESSING_FAILED' : 'PDF_PROCESSING_RETRY', targetId: version.documentId, details: { versionId, attempt: version.processingAttempt, error: malware ? 'Malware detected' : message.slice(0, 500) } } });
    });
    if (message.includes('clamscan failed (1)')) return 'complete';
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
}

let stopping = false;
let nextReconciliation=0;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
while (!stopping) {
  try {
    const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: cfg.SQS_QUEUE_URL, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 1800 }));
    for (const msg of result.Messages ?? []) {
      if (!msg.Body || !msg.ReceiptHandle) continue;
      try {
        const event = eventSchema.parse(JSON.parse(msg.Body));
        const status = await processVersion(event.versionId, msg.ReceiptHandle);
        if (status === 'complete') await sqs.send(new DeleteMessageCommand({ QueueUrl: cfg.SQS_QUEUE_URL, ReceiptHandle: msg.ReceiptHandle }));
        else await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: cfg.SQS_QUEUE_URL, ReceiptHandle: msg.ReceiptHandle, VisibilityTimeout: 60 }));
      } catch (error) {
        console.error('PDF worker failure', error);
        // Don't acknowledge failed queue messages; SQS can redrive to DLQ.
        await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: cfg.SQS_QUEUE_URL, ReceiptHandle: msg.ReceiptHandle, VisibilityTimeout: 60 }));
      }
    }
    // Low-frequency recovery of legacy validated versions missing protected
    // previews. At most one file per pass; never rescan completed versions.
    if(!stopping&&Date.now()>=nextReconciliation){
      nextReconciliation=Date.now()+15*60_000;
      try{
        const candidate=await db.documentVersion.findFirst({where:{
          previewReady:false,state:{in:['READY','PUBLISHED']},processingAttempt:{lt:5},
          document:{state:{not:'DELETED'}},
          OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}],
        },select:{id:true},orderBy:{createdAt:'asc'}});
        if(candidate)await repairMissingPreviews(candidate.id);
      }catch(error){console.error('PDF missing-preview reconciliation failed',error);}
    }
  } catch (error) {
    console.error('PDF worker polling error', error);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
await db.$disconnect();
s3.destroy(); sqs.destroy();
