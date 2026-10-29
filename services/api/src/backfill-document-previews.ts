/** Explicit one-off migration utility for already-published scanned PDFs.
 * Run only after verifying Poppler, ClamAV, AWS identity and DB connection.
 * It never publishes files or changes access grants. Safe to rerun: only
 * versions missing page renditions are selected.
 */
import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { execFile as callbackExec } from 'node:child_process';
import { promisify } from 'node:util';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { awsClients } from './aws.js';
import { assertWorkerPrerequisites } from './worker-prerequisites.js';
import { createPrivatePagePreviews } from './document-preview-render.js';

const execFile = promisify(callbackExec);
await assertWorkerPrerequisites();
const cfg = loadConfig();
const db = new PrismaClient();
const { s3, sqs } = awsClients(cfg);
let failed = false;
try {
  await db.$queryRaw`SELECT 1`;
  await s3.config.credentials();
  const versions = await db.documentVersion.findMany({
    where: { previewReady: false, state: { in: ['READY', 'PUBLISHED'] }, document: { state: { not: 'DELETED' } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, objectKey: true, objectVersionId: true, pageCount: true },
  });
  console.log(`Verified historic PDF versions needing private previews: ${versions.length}`);
  let completed = 0;
  let failures = 0;
  for (const [index, version] of versions.entries()) {
    console.info(`Starting private preview ${index + 1}/${versions.length} (version=${version.id}, pages=${version.pageCount ?? 'unknown'})`);
    let dir: string | undefined;
    try {
      if (!version.pageCount || version.pageCount < 1) throw new Error('Missing verified page count');
      dir = await fs.mkdtemp(join(tmpdir(), 'dochub-preview-backfill-'));
      const pdf = join(dir, 'source.pdf');
      const response = await s3.send(new GetObjectCommand({
        Bucket: cfg.S3_BUCKET, Key: version.objectKey,
        VersionId: version.objectVersionId ?? undefined,
      }));
      if (!response.Body) throw new Error('PDF object unavailable');
      console.info('Private preview stage: downloading protected source');
      await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(pdf, { flags: 'wx', mode: 0o600 }));
      // Re-scan legacy versions before rendering; never trust prior state alone.
      console.info('Private preview stage: malware scanning');
      await execFile('clamscan', ['--no-summary', '--max-filesize=0', '--max-scansize=0', pdf], { timeout: 20 * 60 * 1000 });
      console.info('Private preview stage: rendering and storing private pages in bounded batches');
      await createPrivatePagePreviews(s3, cfg.S3_BUCKET, pdf, dir, version.id, version.pageCount);
      await db.documentVersion.updateMany({
        where: { id: version.id, state: { in: ['READY', 'PUBLISHED'] }, previewReady: false },
        data: { previewReady: true },
      });
      completed++;
      console.log(`Preview prepared for version ${version.id}: ${version.pageCount} pages`);
    } catch (error) {
      failed = true;
      failures++;
      console.error(`Preview preparation failed for ${version.id}:`, error instanceof Error ? error.message : 'unknown error');
    } finally {
      if (dir) await fs.rm(dir, { force: true, recursive: true });
    }
  }
  console.info(`Private preview backfill finished: completed=${completed}, failed=${failures}, total=${versions.length}`);
} finally {
  await db.$disconnect();
  s3.destroy();
  sqs.destroy();
}
if (failed) process.exitCode = 1;
