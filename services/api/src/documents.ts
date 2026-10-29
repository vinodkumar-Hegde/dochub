import {watermarkSettings} from './workspace-controls.js';
import { isTaxonomyAvailable } from './academic-lifecycle-policy.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, HeadObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Config } from './config.js';
import { assertRole, AuthError, type Principal } from './auth.js';
import { MAX_MULTIPART_PARTS, MULTIPART_PART_BYTES, partCount, validUploadMapping } from './documents-policy.js';
import { allowedSubjectIds, choosePreviewVersion, hasExactEnrollment } from './document-access-policy.js';
import { isStudentDocumentVisible } from './folders-policy.js';
import { canDownloadOriginal, effectiveDocumentPermissions, previewPageKey, studentReaderMode } from './document-permissions.js';
import { resolveProgrammeSelection } from './programme-targets.js';
import {isStudyPageValid,validateStudyStrokes} from './study-policy.js';
import {embeddedJpegInfo,safeStudentWatermark,streamStudentWatermarkedPdf} from './student-watermarked-pdf.js';
import {canExportStudentPdf} from './student-pdf-export-policy.js';
import {assertPublicationAllowed,publishDocument,publishRequestedVersion,publicationTransaction} from './document-publication.js';
import {createPreviewDeliverySigner} from './preview-cdn.js';
import {publishablePreview} from './pdf-preview-job-policy.js';

const uuid = z.string().uuid();
const listQuery = z.object({ courseId: uuid.optional(), programmeId: uuid.optional(), folderId: uuid.optional(), subjectId: uuid.optional(), query: z.string().trim().max(120).optional(), cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(50).default(25) });
const create = z.object({
  title: z.string().trim().min(1).max(240), courseId: uuid.optional(),
  programmeId: uuid, subjectId: uuid,
  planIds: z.array(uuid).min(1).max(100).optional(), mappingRevision:z.number().int().nonnegative().optional(), folderId:uuid.nullable().optional(),
  sizeBytes: z.number().int().positive().safe(),
});
const partRequest = z.object({ partNumber: z.coerce.number().int().min(1).max(10000) });
const completion = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), eTag: z.string().min(1) })).min(1).max(10000) });
const adminRoles = ['SUPER_ADMIN', 'CONTENT_MANAGER'] as const;


export const isEnrolledForDocument = hasExactEnrollment;

export function registerDocuments(app: FastifyInstance, db: PrismaClient, s3: S3Client, cfg: Config, authenticate: (req: import('fastify').FastifyRequest) => Promise<Principal>) {

  const signPreviewDelivery=createPreviewDeliverySigner(cfg);

  app.get('/v1/documents/upload-policy', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    return { maxPdfBytes: cfg.MAX_PDF_BYTES, partBytes: MULTIPART_PART_BYTES };
  });

  // A small, paginated administration projection. No object keys or S3 credentials leave the API.
  app.get('/v1/documents', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const input = listQuery.parse(req.query);
    const rows = await db.document.findMany({
      where: {
        state: { not: 'DELETED' },
        ...(input.courseId ? { courseId: input.courseId } : {}),
        ...(input.programmeId ? { programmeId: input.programmeId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.query ? { title: { contains: input.query, mode: 'insensitive' as const } } : {}),
      },
      take: input.limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        grants: { select: { planId: true } }, folder:{select:{hidden:true,locked:true}},
        versions: { where: { state: { not: 'DELETED' } }, orderBy: { number: 'desc' }, take: 1, select: {
          id: true, number: true, state: true, pageCount: true, failureReason: true,
          sizeBytes: true, createdAt: true, processingAttempt: true, previewReady: true, publishRequestedById:true, publicationFailure:true,
        } },
      },
    });
    const hasMore = rows.length > input.limit;
    const [total,publishedTotal] = await Promise.all([
      db.document.count({ where: { state: { not: 'DELETED' } } }),
      db.document.count({ where: { state: 'PUBLISHED' } }),
    ]);
    return { total, publishedTotal,
      items: rows.slice(0, input.limit).map(d => ({
        id: d.id, title: d.title, courseId: d.courseId, programmeId: d.programmeId,
        subjectId: d.subjectId, folderId:d.folderId, hidden:d.hidden, locked:d.locked, allowDownload:d.allowDownload, allowPrint:d.allowPrint, revision:d.revision, planIds: d.grants.map(g => g.planId), status: d.state,
        createdAt: d.createdAt.toISOString(), canManage: principal.canManageModule!==false && (d.createdById === principal.userId || principal.roles.includes('SUPER_ADMIN')),
        latestVersion: d.versions[0] ? {
          ...d.versions[0], publishWhenReady:Boolean(d.versions[0].publishRequestedById), publishRequestedById:undefined, canPublish: publishablePreview(d.versions[0].state, d.versions[0].previewReady, d.versions[0].pageCount), sizeBytes: d.versions[0].sizeBytes.toString(),
          createdAt: d.versions[0].createdAt.toISOString(),
        } : null,
      })),
      nextCursor: hasMore ? (rows[input.limit - 1]?.id ?? null) : null,
    };
  });

  app.post('/v1/documents/uploads', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const input = create.parse(req.body);
    if (input.sizeBytes > cfg.MAX_PDF_BYTES || partCount(input.sizeBytes) > MAX_MULTIPART_PARTS) throw new AuthError(413, 'File exceeds configured upload limit');
    const targets = await resolveProgrammeSelection(db, input);
    if(input.folderId){
      const folder=await db.documentFolder.findUnique({where:{id:input.folderId}});
      if(!folder||folder.locked||folder.courseId!==targets.courseId||folder.programmeId!==input.programmeId||folder.subjectId!==input.subjectId)
        throw new AuthError(422,'Choose an unlocked folder within the selected subject');
    }
    const documentId = randomUUID(), versionId = randomUUID();
    const key = `private/documents/${documentId}/${versionId}/original.pdf`;
    // Never use user-supplied filenames in S3 keys.
    const started = await s3.send(new CreateMultipartUploadCommand({
      Bucket: cfg.S3_BUCKET, Key: key, ContentType: 'application/pdf',
      ServerSideEncryption: 'aws:kms', Metadata: { 'document-id': documentId, 'version-id': versionId },
    }));
    if (!started.UploadId) throw new AuthError(502, 'Object storage did not start upload');
    try {
      await db.$transaction(async tx => {
        // Verify again after S3 initiation; approved mappings may change concurrently.
        const confirmed = await resolveProgrammeSelection(tx, { ...input, mappingRevision: targets.mappingRevision });
        await tx.document.create({ data: {
          id: documentId, title: input.title, courseId: confirmed.courseId,
          programmeId: input.programmeId, subjectId: input.subjectId, folderId:input.folderId??null, createdById: principal.userId,
          grants: { create: confirmed.planIds.map(planId => ({ planId })) },
          versions: { create: { id: versionId, number: 1, objectKey: key, s3UploadId: started.UploadId, sizeBytes: BigInt(input.sizeBytes) } },
        }});
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: documentId, action: 'UPLOAD_STARTED', details: { versionId, planIds: confirmed.planIds, mappingRevision: confirmed.mappingRevision } } });
      });
    } catch (error) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: cfg.S3_BUCKET, Key: key, UploadId: started.UploadId })).catch(() => {});
      throw error;
    }
    return reply.code(201).send({ documentId, versionId, uploadId: started.UploadId });
  });

  app.post('/v1/documents/:id/versions/:versionId/parts/:partNumber/sign', async (req) => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const params = z.object({ id: uuid, versionId: uuid, partNumber: z.string() }).parse(req.params);
    const { partNumber } = partRequest.parse(params);
    const version = await db.documentVersion.findFirst({ where: { id: params.versionId, documentId: params.id, state: 'UPLOADING' }, include: { document: true } });
    if (!version?.s3UploadId) throw new AuthError(404, 'Active upload not found');
    if (partNumber > partCount(Number(version.sizeBytes))) throw new AuthError(400, 'Part exceeds expected file size');
    if (version.document.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Upload owned by another user');
    const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket: cfg.S3_BUCKET, Key: version.objectKey, UploadId: version.s3UploadId, PartNumber: partNumber }), { expiresIn: 900 });
    return { url, expiresInSeconds: 900, partNumber };
  });

  app.post('/v1/documents/:id/versions/:versionId/complete', async (req) => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const params = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const { parts } = completion.parse(req.body);
    const version = await db.documentVersion.findFirst({ where: { id: params.versionId, documentId: params.id }, include: { document: true } });
    if (!version) throw new AuthError(404, 'Upload not found');
    if (version.document.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Upload owned by another user');
    if (version.state === 'QUEUED' || version.state === 'PROCESSING' || version.state === 'READY') return { status: version.state };
    if (version.state !== 'UPLOADING' || !version.s3UploadId) throw new AuthError(409, 'Upload cannot be completed in its current state');
    const sorted = [...parts].sort((a,b)=>a.partNumber-b.partNumber);
    if (sorted.some((p,i)=>p.partNumber!==i+1) || sorted.length !== partCount(Number(version.sizeBytes))) throw new AuthError(400, 'Parts must match the declared file size');
    try {
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: cfg.S3_BUCKET, Key: version.objectKey, UploadId: version.s3UploadId, MultipartUpload: { Parts: sorted.map(p => ({ PartNumber: p.partNumber, ETag: p.eTag })) } }));
    } catch (error) {
      // A concurrent completion may already have succeeded; HEAD is authoritative.
      const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.S3_BUCKET, Key: version.objectKey })).catch(() => null);
      if (!head || head.ContentLength !== Number(version.sizeBytes)) throw error;
    }
    const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.S3_BUCKET, Key: version.objectKey }));
    if (head.ContentLength !== Number(version.sizeBytes)) {
      await db.$transaction(async tx => {
        await tx.documentVersion.updateMany({ where: { id: version.id, state: 'UPLOADING' }, data: { state: 'FAILED', s3UploadId: null, failureReason: 'Uploaded object size mismatch' } });
        await tx.document.updateMany({ where: { id: version.documentId, state: { not: 'PUBLISHED' } }, data: { state: 'FAILED' } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: version.documentId, action: 'UPLOAD_SIZE_REJECTED', details: { versionId: version.id } } });
      });
      throw new AuthError(409, 'Uploaded file size mismatch; restart the upload');
    }
    await db.$transaction(async tx => {
      const update = await tx.documentVersion.updateMany({ where: { id: version.id, state: 'UPLOADING' }, data: { state: 'QUEUED', objectVersionId: head.VersionId, queuedAt: new Date(), s3UploadId: null } });
      if (update.count !== 1) return;
      await tx.document.updateMany({ where: { id: version.documentId, state: { not: 'PUBLISHED' } }, data: { state: 'QUEUED' } });
      await tx.outboxEvent.create({ data: { topic: 'PDF_PROCESS', aggregateId: version.id, payload: { versionId: version.id } } });
      await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: version.documentId, action: 'UPLOAD_COMPLETED', details: { versionId: version.id } } });
    });
    return { status: 'QUEUED' };
  });

  app.post('/v1/documents/:id/versions/:versionId/retry', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const params = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    await db.$transaction(async tx => {
      const version = await tx.documentVersion.findFirst({ where: { id: params.versionId, documentId: params.id }, include: { document: true } });
      if (!version) throw new AuthError(404, 'Document version not found');
      if (version.document.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Not authorized to retry');
      if (version.state !== 'FAILED') throw new AuthError(409, 'Only failed processing jobs can be retried');
      if (version.processingAttempt >= 5 && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Administrator intervention required after the retry limit');
      await tx.documentVersion.update({ where: { id: version.id }, data: { state: 'QUEUED', queuedAt: new Date(), failureReason: null, processingAttempt: 0 } });
      await tx.document.updateMany({ where: { id: params.id, state: { not: 'PUBLISHED' } }, data: { state: 'QUEUED' } });
      await tx.outboxEvent.create({ data: { topic: 'PDF_PROCESS', aggregateId: version.id, payload: { versionId: version.id } } });
      await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: params.id, action: 'PROCESSING_RETRIED', details: { versionId: version.id } } });
    });
    return { status: 'QUEUED' };
  });


  // Cancel an unfinished upload. S3 lifecycle also cleans up abandoned multipart uploads.
  app.post('/v1/documents/:id/versions/:versionId/abort', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const { id, versionId } = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const version = await db.documentVersion.findFirst({ where: { id: versionId, documentId: id }, include: { document: true } });
    if (!version) throw new AuthError(404, 'Upload not found');
    if (version.document.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Not authorized');
    if (version.state === 'DELETED') return { status: 'DELETED' };
    if (version.state !== 'UPLOADING' || !version.s3UploadId) throw new AuthError(409, 'Only active transfers can be cancelled');
    // Abort S3 first. If AWS is temporarily unavailable, keep the DB upload
    // cancellable instead of marking it deleted while multipart parts remain.
    try {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: cfg.S3_BUCKET, Key: version.objectKey, UploadId: version.s3UploadId,
      }));
    } catch (error) {
      // S3 can report NoSuchUpload after a previous successful abort.
      if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'NoSuchUpload') {
        app.log.error({ err: error, documentId: id }, 'S3 upload cancellation failed');
        throw new AuthError(502, 'Could not cancel S3 upload; retry cancellation');
      }
    }
    await db.$transaction(async tx => {
      const updated = await tx.documentVersion.updateMany({
        where: { id: versionId, state: 'UPLOADING', s3UploadId: version.s3UploadId },
        data: { state: 'DELETED', s3UploadId: null },
      });
      if (!updated.count) throw new AuthError(409, 'Upload state changed; reload');
      await tx.document.updateMany({ where: { id, state: 'UPLOADING' }, data: { state: 'DELETED' } });
      await tx.auditEvent.create({ data: {
        actorId: principal.userId, targetId: id, action: 'UPLOAD_ABORTED', details: { versionId },
      } });
    });
    return { status: 'DELETED' };
  });

  // Soft deletion preserves versioned originals and audit trails for controlled retention.
  app.delete('/v1/documents/:id', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await db.$transaction(async tx => {
      const document = await tx.document.findUnique({ where: { id }, include:{folder:true} });
      if (!document) throw new AuthError(404, 'Document not found');
      if (document.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Not authorized');
      if (document.locked || document.folder?.locked) throw new AuthError(409, 'Unlock the file and folder before deleting');
      if (document.state === 'DELETED') return;
      const active = await tx.documentVersion.count({ where: { documentId: id, state: { in: ['UPLOADING', 'QUEUED', 'PROCESSING'] } } });
      if (active) throw new AuthError(409, 'Cancel or complete active processing before deleting');
      const updated = await tx.document.updateMany({ where: { id, state: document.state }, data: { state: 'DELETED' } });
      if (!updated.count) throw new AuthError(409, 'Document state changed; reload');
      await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: id, action: 'DOCUMENT_SOFT_DELETED', details: { previousState: document.state } } });
    });
    return { status: 'DELETED' };
  });

  // Replacement retains the previous published PDF until the replacement is scanned and explicitly published.
  app.post('/v1/documents/:id/versions', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const input = z.object({ sizeBytes: z.number().int().positive().safe() }).parse(req.body);
    if (input.sizeBytes > cfg.MAX_PDF_BYTES || partCount(input.sizeBytes) > MAX_MULTIPART_PARTS) throw new AuthError(413, 'File exceeds configured limit');
    const doc = await db.document.findUnique({ where: { id }, include: { grants: true, folder:true } });
    if (!doc || doc.state === 'DELETED') throw new AuthError(404, 'Document not found');
    if (doc.createdById !== principal.userId && !principal.roles.includes('SUPER_ADMIN')) throw new AuthError(403, 'Not authorized');
    if (doc.locked || doc.folder?.locked) throw new AuthError(409, 'Unlock the file and folder before replacing');
    if (!['READY', 'PUBLISHED', 'FAILED'].includes(doc.state)) throw new AuthError(409, 'Current upload or processing must finish first');
    await resolveProgrammeSelection(db, { courseId: doc.courseId, programmeId: doc.programmeId, subjectId: doc.subjectId, planIds: doc.grants.map(g => g.planId) });
    const versionId = randomUUID(), key = `private/documents/${id}/${versionId}/original.pdf`;
    const started = await s3.send(new CreateMultipartUploadCommand({ Bucket: cfg.S3_BUCKET, Key: key, ContentType: 'application/pdf', ServerSideEncryption: 'aws:kms', Metadata: { 'document-id': id, 'version-id': versionId } }));
    if (!started.UploadId) throw new AuthError(502, 'Object storage did not start replacement');
    try {
      await db.$transaction(async tx => {
        const latest = await tx.documentVersion.findFirst({ where: { documentId: id }, orderBy: { number: 'desc' } });
        if (latest && ['UPLOADING', 'QUEUED', 'PROCESSING'].includes(latest.state)) throw new AuthError(409, 'A replacement is already in progress');
        await tx.documentVersion.create({ data: { id: versionId, documentId: id, number: (latest?.number ?? 0) + 1, objectKey: key, s3UploadId: started.UploadId, sizeBytes: BigInt(input.sizeBytes) } });
        if (doc.state !== 'PUBLISHED') await tx.document.updateMany({ where: { id, state: doc.state }, data: { state: 'UPLOADING' } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: id, action: 'REPLACEMENT_STARTED', details: { versionId } } });
      });
    } catch (error) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: cfg.S3_BUCKET, Key: key, UploadId: started.UploadId })).catch(() => {});
      throw error;
    }
    return reply.code(201).send({ documentId: id, versionId, uploadId: started.UploadId });
  });

  // Programme-first navigation is built from actual subscriptions, including
  // programmes with no published PDFs. Unsubscribed subjects are not exposed.
  app.get('/v1/student/catalogue', async req => {
    const principal = await authenticate(req); assertRole(principal, ['STUDENT']);
    const now = new Date();
    const enrollments = await db.enrollment.findMany({
      where: { userId: principal.userId, activeFrom:{lte:now}, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      select: { courseId: true, programmeId: true, subjectId: true, planId: true },
    });
    const programmes = await db.academicProgramme.findMany({
      where: { id: { in: enrollments.map(e => e.programmeId) }, locked: true,hidden:false,accessLocked:false,archivedAt:null,course:{hidden:false,accessLocked:false,archivedAt:null} },
      include: {
        course: { select: { name: true } },
        plans: { include:{plan:{select:{hidden:true,accessLocked:true,archivedAt:true}}} }, subjects: { include: { subject: { select: { name: true,hidden:true,accessLocked:true,archivedAt:true } } } },
      },
    });
    const results = programmes.map(p => {
      const activePlans=new Set(p.plans.filter(link=>isTaxonomyAvailable(link.plan)).map(link=>link.planId));
      const enrolledSubjects = allowedSubjectIds(enrollments.filter(g=>activePlans.has(g.planId)), p);
      const subjects = p.subjects.filter(link => enrolledSubjects.has(link.subjectId)&&isTaxonomyAvailable(link.subject)).map(link => ({
        id: link.subjectId, name: link.subject.name,
      }));
      return { id: p.id, name: p.name, courseId: p.courseId, courseName: p.course.name, subjects };
    }).filter(p => p.subjects.length > 0);
    return { programmes: results };
  });

  // Only folders within an active, approved subject subscription are discoverable.
  app.get('/v1/student/folders', async req=>{
    const principal=await authenticate(req);assertRole(principal,['STUDENT']);
    const {programmeId,subjectId}=z.object({programmeId:uuid,subjectId:uuid}).parse(req.query);
    const now=new Date();
    const grants=await db.enrollment.findMany({where:{userId:principal.userId,programmeId,subjectId,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}});
    if(!grants.length)return {items:[]};
    const p=await db.academicProgramme.findUnique({where:{id:programmeId},include:{subjects:true,plans:true,course:true}});
    if(!p?.locked||!isTaxonomyAvailable(p)||!isTaxonomyAvailable(p.course)||!p.subjects.some(s=>s.subjectId===subjectId)||!isTaxonomyAvailable(await db.academicSubject.findUnique({where:{id:subjectId}})))return {items:[]};
    const validPlans=await db.academicPlan.findMany({where:{id:{in:grants.map(g=>g.planId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true}});
    if(!grants.some(g=>g.courseId===p.courseId&&validPlans.some(v=>v.id===g.planId)&&p.plans.some(link=>link.planId===g.planId)))return {items:[]};
    return {items:await db.documentFolder.findMany({where:{programmeId,subjectId,hidden:false,locked:false},select:{id:true,name:true},orderBy:{name:'asc'}})};
  });

  // Student catalogue is derived exclusively from the authenticated student's
  // active enrollments, never from a student ID supplied by the browser.
  app.get('/v1/student/materials', async req => {
    const principal = await authenticate(req); assertRole(principal, ['STUDENT']);
    const { cursor, limit } = z.object({ cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const now = new Date();
    const enrollments = await db.enrollment.findMany({
      where: { userId: principal.userId, activeFrom:{lte:now}, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      select: { courseId: true, programmeId: true, subjectId: true, planId: true, validUntil: true },
    });
    if (!enrollments.length) return { items: [], nextCursor: null };
    const scopes = enrollments.map(e => ({
      courseId: e.courseId, programmeId: e.programmeId, subjectId: e.subjectId,
      grants: { some: { planId: e.planId } },
    }));
    const docs = await db.document.findMany({
      where: { state: 'PUBLISHED', hidden:false, locked:false, OR:[{folderId:null},{folder:{hidden:false,locked:false}}], AND:[{OR:scopes}] },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        grants: { select: { planId: true } },
        versions: {
          where: { state: 'PUBLISHED' }, orderBy: { number: 'desc' }, take: 1,
          select: { id: true, pageCount: true },
        },
      },
    });
    const page = docs.slice(0, limit);
    const [programmes, courses, subjects] = await Promise.all([
      db.academicProgramme.findMany({ where: { id: { in: page.map(d => d.programmeId) },hidden:false,accessLocked:false,archivedAt:null,course:{hidden:false,accessLocked:false,archivedAt:null} },
        include: { plans: { include:{plan:true} }, subjects: {include:{subject:true}} } }),
      db.academicCourse.findMany({ where: { id: { in: page.map(d => d.courseId) },hidden:false,accessLocked:false,archivedAt:null }, select: { id: true, name: true } }),
      db.academicSubject.findMany({ where: { id: { in: page.map(d => d.subjectId) },hidden:false,accessLocked:false,archivedAt:null }, select: { id: true, name: true } }),
    ]);
    const programmeById = new Map(programmes.map(p => [p.id, p]));
    const courseById = new Map(courses.map(c => [c.id, c.name]));
    const subjectById = new Map(subjects.map(s => [s.id, s.name]));
    const items = page.filter(d => {
      const p = programmeById.get(d.programmeId) ?? null;
      const livePlans=new Set(p?.plans.filter(link=>isTaxonomyAvailable(link.plan)).map(link=>link.planId)??[]);
      const validEnrollments=enrollments.filter(g=>livePlans.has(g.planId));
      return d.versions.length > 0 && courseById.has(d.courseId) && subjectById.has(d.subjectId) && validUploadMapping(p, {
        courseId: d.courseId, programmeId: d.programmeId, subjectId: d.subjectId, planIds: d.grants.map(g => g.planId),
      }) && isEnrolledForDocument(validEnrollments, d, now);
    }).map(d => ({
      id: d.id, title: d.title, folderId:d.folderId, courseId: d.courseId,
      courseName: courseById.get(d.courseId) ?? '',
      programmeId: d.programmeId, programmeName: programmeById.get(d.programmeId)?.name ?? '',
      subjectId: d.subjectId, subjectName: subjectById.get(d.subjectId) ?? '',
      pageCount: d.versions[0]?.pageCount ?? null,
    }));
    return { items, nextCursor: docs.length > limit ? (page[page.length - 1]?.id ?? null) : null };
  });

  app.get('/v1/documents/:id', async req => {
    const principal = await authenticate(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const document = await db.document.findUnique({ where: { id }, include: { folder:true, grants: true, versions: { orderBy: { number: 'desc' }, take: 1 } } });
    if (!document || document.state === 'DELETED') throw new AuthError(404, 'Document not found');
    const isAdmin = principal.roles.some(r => adminRoles.includes(r as typeof adminRoles[number]));
    if (!isAdmin) {
      assertRole(principal, ['STUDENT']);
      if (document.state !== 'PUBLISHED' || !isStudentDocumentVisible(document)) throw new AuthError(404, 'Document not found');
      const programme = await db.academicProgramme.findUnique({ where: { id: document.programmeId }, include: { plans: true, subjects: true,course:true } });
      if(!isTaxonomyAvailable(programme)||!isTaxonomyAvailable(programme?.course)||!isTaxonomyAvailable(await db.academicSubject.findUnique({where:{id:document.subjectId}})))throw new AuthError(403,'Academic content unavailable');
      if (!validUploadMapping(programme, { courseId: document.courseId, programmeId: document.programmeId, subjectId: document.subjectId, planIds: document.grants.map(g => g.planId) })) throw new AuthError(403, 'Document entitlement no longer valid');
      const enrollments = await db.enrollment.findMany({ where: { userId: principal.userId,activeFrom:{lte:new Date()},OR:[{validUntil:null},{validUntil:{gt:new Date()}}] } });
      const availablePlans=await db.academicPlan.findMany({where:{id:{in:enrollments.map(e=>e.planId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true}});
      const live=new Set(availablePlans.map(plan=>plan.id));
      if (!isEnrolledForDocument(enrollments.filter(g=>live.has(g.planId)), document)) throw new AuthError(403, 'Document access denied');
    }
    const latest = isAdmin ? document.versions[0] : await db.documentVersion.findFirst({ where: { documentId: id, state: 'PUBLISHED' }, orderBy: { number: 'desc' } });
    return { id: document.id, title: document.title, state: document.state, latestVersion: latest && { id: latest.id, state: latest.state, pageCount: latest.pageCount, failureReason: isAdmin ? latest.failureReason : undefined } };
  });

  app.post('/v1/documents/:id/publish', async req => {
    const principal = await authenticate(req); assertRole(principal, [...adminRoles]);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await publicationTransaction(db,tx=>publishDocument(tx,id,principal));
    return { status: 'PUBLISHED' };
  });


  app.put('/v1/documents/:id/publication-intent',async req=>{
    const principal=await authenticate(req);assertRole(principal,[...adminRoles]);
    const {id}=z.object({id:uuid}).parse(req.params);
    const input=z.object({versionId:uuid,enabled:z.boolean()}).strict().parse(req.body);
    await publicationTransaction(db,async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
      const document=await tx.document.findUnique({where:{id}});
      if(!document||document.state==='DELETED')throw new AuthError(404,'Document not found');
      if(document.createdById!==principal.userId&&!principal.roles.includes('SUPER_ADMIN'))throw new AuthError(403,'Not authorized');
      const latest=await tx.documentVersion.findFirst({where:{documentId:id,state:{not:'DELETED'}},orderBy:{number:'desc'}});
      if(!latest||latest.id!==input.versionId)throw new AuthError(409,'The PDF version changed. Refresh and try again.');
      if(input.enabled){
        if(latest.state==='READY'&&!latest.previewReady&&latest.processingAttempt>=5)throw new AuthError(409,'Page preparation needs administrator attention before automatic publication can be scheduled');
        await assertPublicationAllowed(tx,id,principal);
        if(!['UPLOADING','QUEUED','PROCESSING','READY'].includes(latest.state))throw new AuthError(409,'This version cannot be scheduled for publication');
      }
      if((input.enabled?latest.publishRequestedById===principal.userId:!latest.publishRequestedById)&&!latest.publicationFailure)return;
      if(input.enabled&&latest.state==='READY'&&!latest.previewReady)await tx.outboxEvent.create({data:{topic:'PDF_PROCESS',aggregateId:latest.id,payload:{versionId:latest.id}}});
      await tx.documentVersion.update({where:{id:latest.id},data:{publishRequestedById:input.enabled?principal.userId:null,publicationFailure:null,publicationRequestRevision:{increment:1}}});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:input.enabled?'AUTO_PUBLICATION_REQUESTED':'AUTO_PUBLICATION_CANCELLED',details:{versionId:latest.id}}});
    });
    if(input.enabled)await publishRequestedVersion(db,input.versionId).catch(error=>req.log.error({err:error},'Deferred publication will retry in worker'));
    return {status:input.enabled?'SCHEDULED':'CANCELLED'};
  });

  /** Document authorization is always evaluated at request time. Student
   * previews return NO original-PDF URL, even when print/download is allowed.
   * Instead the browser requests private rendered pages with bearer auth. */
  async function authorizeRead(req: import('fastify').FastifyRequest) {
    const principal = await authenticate(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const isAdmin = principal.roles.some(r => adminRoles.includes(r as typeof adminRoles[number]));
    const doc = await db.document.findUnique({
      where: { id },
      include: { folder: true, grants: true, versions: {
        where: { state: { in: ['READY', 'PUBLISHED'] } }, orderBy: { number: 'desc' },
        select: { id: true, state: true, objectKey: true, objectVersionId: true, pageCount: true, previewReady: true },
      } },
    });
    if (!doc || doc.state === 'DELETED' || (!isAdmin && (doc.state !== 'PUBLISHED' || !isStudentDocumentVisible(doc)))) {
      throw new AuthError(404, 'Document not found');
    }
    if (!isAdmin) {
      assertRole(principal, ['STUDENT']);
      const programme = await db.academicProgramme.findUnique({
        where: { id: doc.programmeId }, include: { plans: true, subjects: true,course:true },
      });
      if(!isTaxonomyAvailable(programme)||!isTaxonomyAvailable(programme?.course)||!isTaxonomyAvailable(await db.academicSubject.findUnique({where:{id:doc.subjectId}})))throw new AuthError(403,'Academic content unavailable');
      if (!validUploadMapping(programme, { courseId: doc.courseId, programmeId: doc.programmeId, subjectId: doc.subjectId, planIds: doc.grants.map(g => g.planId) })) {
        throw new AuthError(403, 'Document entitlement no longer valid');
      }
      const enrollments = await db.enrollment.findMany({
        where: { userId: principal.userId,activeFrom:{lte:new Date()}, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
      });
      const availablePlans=await db.academicPlan.findMany({where:{id:{in:enrollments.map(e=>e.planId)},hidden:false,accessLocked:false,archivedAt:null},select:{id:true}});
      const live=new Set(availablePlans.map(plan=>plan.id));
      if (!isEnrolledForDocument(enrollments.filter(g=>live.has(g.planId)), doc)) throw new AuthError(403, 'Document access denied');
    }
    const selected = choosePreviewVersion(doc.state, doc.versions, isAdmin);
    if (!selected) throw new AuthError(409, 'No validated PDF version is available to preview');
    return { principal, doc, selected, isAdmin, id };
  }

  async function auditRead(userId: string, id: string, versionId: string, action: string) {
    await db.auditEvent.create({ data: { actorId: userId, targetId: id, action, details: { versionId } } });
  }

  // Study marks are private to the authenticated learner and selected published
  // version. The original PDF and S3 object keys are never sent to the client.
  const studyVersionQuery=z.object({versionId:uuid}).strict();
  const studyPageParams=z.object({id:uuid,page:z.coerce.number().int()});
  // Temporary non-PII diagnostics. Remove after identifying the runtime fault.
  // Each event contains only stage, error class, Prisma error code and call-site
  // frames. Never log authorization headers, object keys, query values or email.
  function reportStudyRuntimeFailure(req:import('fastify').FastifyRequest,stage:string,error:unknown){
    const event={
      event:'DOCHUB_STUDY_FAILURE',
      requestId:req.id,
      stage,
      errorName:error instanceof Error?error.name:'NonError',
      prismaCode:error instanceof Prisma.PrismaClientKnownRequestError?error.code:null,
      frames:error instanceof Error?(error.stack??'').split('\n').slice(1,4).map(frame=>frame.trim()):[],
    };
    process.stderr.write(JSON.stringify(event)+'\n');
  }
  async function traceStudyRuntime<T>(req:import('fastify').FastifyRequest,stage:string,fn:()=>Promise<T>):Promise<T>{
    try{return await fn();}
    catch(error){reportStudyRuntimeFailure(req,stage,error);throw error;}
  }
  async function authorizeStudy(req:import('fastify').FastifyRequest,withPage=false){
    const context=await traceStudyRuntime(req,'document-authorization',()=>authorizeRead(req));
    try{
      assertRole(context.principal,['STUDENT']);
      const {versionId}=studyVersionQuery.parse(req.query);
      if(versionId!==context.selected.id||!context.selected.previewReady||!context.selected.pageCount){
        throw new AuthError(409,'Published PDF preview has changed; refresh your learning materials');
      }
      let page:number|undefined;
      if(withPage){
        page=studyPageParams.parse(req.params).page;
        if(!isStudyPageValid(page,context.selected.pageCount))throw new AuthError(404,'Page not found');
      }
      return {...context,page};
    }catch(error){reportStudyRuntimeFailure(req,'study-version-validation',error);throw error;}
  }
  function guardStudyMutation(req:import('fastify').FastifyRequest){
    if(req.headers.origin!==new URL(cfg.CORS_ORIGIN).origin)throw new AuthError(403,'Invalid study origin');
    if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new AuthError(415,'JSON required');
  }
  app.get('/v1/documents/:id/study',async(req,reply)=>{
    const {principal,id,selected}=await authorizeStudy(req);
    const [marks,user]=await Promise.all([
      traceStudyRuntime(req,'study-progress-query',()=>db.documentStudyPage.findMany({where:{userId:principal.userId,documentId:id,versionId:selected.id},select:{page:true,isRead:true,strokeCount:true},orderBy:{page:'asc'}})),
      traceStudyRuntime(req,'student-email-query',()=>db.user.findUnique({where:{id:principal.userId},select:{email:true}})),
    ]);
    if(!user?.email)throw new AuthError(409,'Student email is required for personalized document watermark');
    reply.header('Cache-Control','private, no-store');
    return {email:user.email,pages:marks.map(p=>({page:p.page,isRead:p.isRead,hasInk:p.strokeCount>0}))};
  });
  app.get('/v1/documents/:id/study/pages/:page',async(req,reply)=>{
    const {principal,id,selected,page}=await authorizeStudy(req,true);
    const row=await traceStudyRuntime(req,'study-page-query',()=>db.documentStudyPage.findUnique({where:{userId_documentId_versionId_page:{userId:principal.userId,documentId:id,versionId:selected.id,page:page!}}}));
    reply.header('Cache-Control','private, no-store');
    return {page,isRead:row?.isRead??false,strokes:row?.strokes??[],revision:row?.revision??0};
  });
  // Read ticks update the DB independently of ink, preserving both on all devices.
  app.patch('/v1/documents/:id/study/pages/:page/read',async req=>{
    guardStudyMutation(req);
    const {principal,id,selected,page}=await authorizeStudy(req,true);
    const {isRead}=z.object({isRead:z.boolean()}).strict().parse(req.body);
    const updated=await db.$transaction(async tx=>{
      const row=await tx.documentStudyPage.upsert({where:{userId_documentId_versionId_page:{userId:principal.userId,documentId:id,versionId:selected.id,page:page!}},create:{userId:principal.userId,documentId:id,versionId:selected.id,page:page!,isRead,strokes:[]},update:{isRead,revision:{increment:1}}});
      await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'STUDENT_PAGE_READ_CHANGED',details:{versionId:selected.id,page,isRead}}});
      return row;
    });
    return {page,isRead:updated.isRead,revision:updated.revision};
  });
  // Optimistic revision ensures a second device cannot silently overwrite ink.
  app.put('/v1/documents/:id/study/pages/:page',async req=>{
    guardStudyMutation(req);
    const {principal,id,selected,page}=await authorizeStudy(req,true);
    const input=z.object({revision:z.number().int().min(0),strokes:z.unknown()}).strict().parse(req.body);
    // Preserve the type guard across the Prisma transaction callback. A mutable
    // object property is not guaranteed to stay narrowed inside a closure.
    const strokes=input.strokes;
    if(!validateStudyStrokes(strokes))throw new AuthError(422,'Invalid or oversized annotation');
    let result;
    try{
      result=await db.$transaction(async tx=>{
        const key={userId:principal.userId,documentId:id,versionId:selected.id,page:page!};
        const old=await tx.documentStudyPage.findUnique({where:{userId_documentId_versionId_page:key}});
        if((old?.revision??0)!==input.revision)throw new AuthError(409,'Annotations changed on another device. Reload the page before editing.');
        if(old){
          const changed=await tx.documentStudyPage.updateMany({where:{id:old.id,revision:input.revision},data:{strokes:strokes as unknown as Prisma.InputJsonValue,strokeCount:strokes.length,revision:{increment:1}}});
          if(changed.count!==1)throw new AuthError(409,'Annotations changed; reload before editing');
        }else{
          await tx.documentStudyPage.create({data:{...key,strokes:strokes as unknown as Prisma.InputJsonValue,strokeCount:strokes.length}});
        }
        await tx.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'STUDENT_ANNOTATION_SAVED',details:{versionId:selected.id,page,strokeCount:strokes.length}}});
        return tx.documentStudyPage.findUniqueOrThrow({where:{userId_documentId_versionId_page:key}});
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&(error.code==='P2002'||error.code==='P2034'))throw new AuthError(409,'Annotations changed; reload before editing');
      throw error;
    }
    return {page,revision:result.revision,isRead:result.isRead};
  });

  app.get('/v1/documents/:id/read', async (req,reply) => {
    reply.header('Cache-Control','private, no-store');
    const { principal, doc, selected, isAdmin, id } = await authorizeRead(req);
    if (studentReaderMode(isAdmin) === 'pages') {
      if (!selected.previewReady || !selected.pageCount) {
        throw new AuthError(409, 'Secure PDF previews are being prepared. Retry shortly or contact support if processing does not finish.');
      }
      await db.materialView.upsert({where:{userId_documentId:{userId:principal.userId,documentId:id}},create:{userId:principal.userId,documentId:id},update:{lastOpenedAt:new Date(),opens:{increment:1}}});
      await auditRead(principal.userId, id, selected.id, 'DOCUMENT_PREVIEW_AUTHORIZED');
      req.server.log.debug({documentId:id},'Student page delivery authorized');
      return { watermark:await watermarkSettings(db), mode: 'pages' as const, versionId: selected.id, pageCount: selected.pageCount,
        ...(signPreviewDelivery?{delivery:signPreviewDelivery(selected.id)}:{}),
        ...effectiveDocumentPermissions(doc) };
    }
    const expiresInSeconds = 120;
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: cfg.S3_BUCKET, Key: selected.objectKey,
      VersionId: selected.objectVersionId ?? undefined,
      ResponseContentDisposition: 'inline', ResponseContentType: 'application/pdf',
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: expiresInSeconds });
    await auditRead(principal.userId, id, selected.id, 'DOCUMENT_READ_AUTHORIZED');
    return { pagePreviewReady:selected.previewReady, mode: 'pdf' as const, url, expiresInSeconds, versionId: selected.id, pageCount: selected.pageCount };
  });

  app.get('/v1/documents/:id/preview/pages/:page', async (req, reply) => {
    const { principal, selected, id } = await authorizeRead(req);
    const page = z.coerce.number().int().positive().parse((req.params as {page?:string}).page);
    const { versionId } = z.object({ versionId: uuid }).strict().parse(req.query);
    if (versionId !== selected.id || !selected.previewReady || !selected.pageCount || page > selected.pageCount) {
      throw new AuthError(404, 'Preview page unavailable');
    }
    const key = previewPageKey(selected.id, page);
    let data;
    try { data = await s3.send(new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: key })); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
        throw new AuthError(503, 'Secure PDF preview page is temporarily unavailable');
      }
      throw error;
    }
    if (!data.Body) throw new AuthError(503, 'Secure PDF preview page is unavailable');
    // Never expose the S3 key, presigned URL, or the original PDF to students.
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Content-Disposition', 'inline');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('X-Robots-Tag', 'noindex, noarchive');
    reply.type('image/jpeg');
    // Per-page authorized stream keeps memory bounded and does not create
    // server-side PDF processing work in request handlers.
    return reply.send(data.Body as Readable);
  });

  /** Student print/download always creates a new personalized PDF from the
   * already-rendered private preview pages. No original S3 URL reaches students.
   * Download and print remain independent administrator-managed permissions.
   */
  app.get('/v1/documents/:id/export', async (req, reply) => {
    const {principal,doc,selected,isAdmin,id} = await authorizeRead(req);
    if (isAdmin) throw new AuthError(403,'Use the administrator document export');
    assertRole(principal,['STUDENT']);
    const {versionId,purpose} = z.object({versionId:uuid,purpose:z.enum(['download','print'])}).strict().parse(req.query);
    if (versionId!==selected.id || !selected.previewReady || !selected.pageCount) {
      throw new AuthError(409,'Published secure PDF preview is not available. Refresh My Learning.');
    }
    const permissions=effectiveDocumentPermissions(doc);
    if (!canExportStudentPdf(purpose,permissions)) {
      throw new AuthError(403,`${purpose==='download'?'Download':'Print'} permission is disabled for this material or folder`);
    }
    const user=await db.user.findUnique({where:{id:principal.userId},select:{email:true}});
    if (!user?.email) throw new AuthError(409,'Student email required for protected PDF export');
    try { safeStudentWatermark(user.email); }
    catch { throw new AuthError(409,'Valid student email required for protected PDF export'); }
    // A single protected JPEG is fetched at a time, so huge PDFs need no
    // temporary original-PDF copy, malware rescan or unbounded server buffers.
    const fetchPage=async(page:number):Promise<Uint8Array>=>{
      const data=await s3.send(new GetObjectCommand({Bucket:cfg.S3_BUCKET,Key:previewPageKey(selected.id,page)}));
      if (!data.Body || (data.ContentLength??0)>24*1024*1024) throw new Error('Protected page unavailable');
      const chunks:Buffer[]=[];
      let size=0;
      for await (const chunk of data.Body as AsyncIterable<Uint8Array>){
        const buf=Buffer.from(chunk);
        size+=buf.length;
        if(size>24*1024*1024)throw new Error('Protected page exceeds maximum size');
        chunks.push(buf);
      }
      return Buffer.concat(chunks,size);
    };
    // Validate the first page before sending the HTTP 200 response.
    let first:Uint8Array;
    try { first=await fetchPage(1);embeddedJpegInfo(first); }
    catch {throw new AuthError(503,'Protected PDF pages are temporarily unavailable');}
    const load=(page:number)=>page===1?Promise.resolve(first):fetchPage(page);
    await db.auditEvent.create({data:{actorId:principal.userId,targetId:id,action:'STUDENT_WATERMARKED_PDF_EXPORT',details:{versionId:selected.id,purpose,pageCount:selected.pageCount}}});
    const stream=Readable.from(streamStudentWatermarkedPdf(selected.pageCount,user.email,load,await watermarkSettings(db)));
    reply.header('Cache-Control','private, no-store, max-age=0');
    reply.header('Pragma','no-cache');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('X-Robots-Tag','noindex, noarchive');
    reply.header('Content-Disposition',`${purpose==='download'?'attachment':'inline'}; filename="DocTutorials-watermarked.pdf"`);
    reply.type('application/pdf');
    return reply.send(stream);
  });

  // Administrators may retrieve the original PDF; students never receive an
  // original-object link, including when downloading is enabled.
  app.get('/v1/documents/:id/download', async req => {
    const { principal, doc, selected, isAdmin, id } = await authorizeRead(req);
    if (!canDownloadOriginal(isAdmin, effectiveDocumentPermissions(doc))) throw new AuthError(403, 'Downloading is disabled for this material or its folder');
    if (!isAdmin) {
      if (!selected.previewReady || !selected.pageCount) throw new AuthError(409,'Published secure PDF preview is not available');
      await auditRead(principal.userId,id,selected.id,'DOCUMENT_WATERMARKED_DOWNLOAD_REQUESTED');
      return { mode:'watermarked' as const, path:`/v1/documents/${id}/export?${new URLSearchParams({versionId:selected.id,purpose:'download'})}` };
    }
    const expiresInSeconds = 60;
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: cfg.S3_BUCKET, Key: selected.objectKey,
      VersionId: selected.objectVersionId ?? undefined,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'attachment',
      ResponseCacheControl: 'private, no-store',
    }), { expiresIn: expiresInSeconds });
    await auditRead(principal.userId, id, selected.id, 'DOCUMENT_DOWNLOAD_AUTHORIZED');
    return { url, expiresInSeconds };
  });

}
