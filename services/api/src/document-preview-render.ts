import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { boundedWork } from './bounded-work.js';
import { previewPageKey } from './document-permissions.js';

/** Bound per-process memory and temporary storage independent of PDF length. */
const RENDER_BATCH_SIZE = 12;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;

/** A pure batch planner; never discard pages beyond an arbitrary UI ceiling. */
export function planPreviewBatches(pageCount: number): ReadonlyArray<readonly [number, number]> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('Invalid PDF page count');
  const batches: Array<readonly [number, number]> = [];
  for (let first = 1; first <= pageCount; first += RENDER_BATCH_SIZE) {
    batches.push([first, Math.min(pageCount, first + RENDER_BATCH_SIZE - 1)]);
  }
  return batches;
}

/** Spawn a bounded Poppler process rather than render all pages in one process. */
function renderBatch(pdf: string, outputPrefix: string, first: number, last: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const count = last - first + 1;
    const timeoutMs = Math.max(120_000, count * 30_000);
    const proc = spawn('pdftoppm', [
      '-f', String(first), '-l', String(last), '-jpeg', '-jpegopt', 'quality=78',
      '-scale-to', '1500', pdf, outputPrefix,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, timeoutMs);
    proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-2000); });
    proc.on('error', error => { clearTimeout(timeout); reject(error); });
    proc.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) { resolve(); return; }
      reject(new Error(`PDF pages ${first}-${last} render failed (exit=${code ?? 'none'}, signal=${signal ?? 'none'}, timeout=${timedOut}): ${stderr.slice(-300)}`));
    });
  });
}

/** Runs in a PDF worker/maintenance process only; never in an API request.
 * Pages remain private in S3. The caller may mark previewReady=true only when
 * this method resolves after validating and uploading EVERY numbered page.
 * A retry overwrites the same version-scoped S3 keys safely. */
export async function createPrivatePagePreviews(
  s3: S3Client,
  bucket: string,
  pdfPath: string,
  tempDir: string,
  versionId: string,
  pageCount: number,
  options: {renderConcurrency:number; uploadConcurrency:number} = {renderConcurrency:2,uploadConcurrency:2},
): Promise<void> {
  const batches = planPreviewBatches(pageCount);
  let uploaded = 0;

  await boundedWork(batches, options.renderConcurrency, async ([first,last]) => {
    // Separate directories prevent one renderer from collecting another batch's files.
    const batchDir = await fs.mkdtemp(join(tempDir, 'batch-'));
    const prefix = join(batchDir, 'preview');
    const filePrefix = basename(prefix) + '-';
    try {
      await renderBatch(pdfPath, prefix, first, last);
      const files = (await fs.readdir(batchDir))
        .filter(name => name.startsWith(filePrefix) && name.endsWith('.jpg'))
        .map(name => ({ name, page: Number(name.slice(filePrefix.length, -4)) }))
        .sort((a, b) => a.page - b.page);
      const count = last - first + 1;
      if (files.length !== count) {
        throw new Error(`Preview pages ${first}-${last}: expected ${count} files, got ${files.length}`);
      }
      for(const [i,file] of files.entries()){
        if(file.page!==first+i)throw new Error(`Missing or duplicate PDF preview page ${first+i}`);
      }
      await boundedWork(files, options.uploadConcurrency, async ({name,page}) => {
        const filename = join(batchDir, name);
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PREVIEW_BYTES) {
          throw new Error(`Invalid PDF preview image size at page ${page}`);
        }
        // Each upload holds one page; overall memory is bounded by concurrency. Never upload
        // public renditions or expose raw S3 keys to the frontend.
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: previewPageKey(versionId, page),
          Body: await fs.readFile(filename),
          ContentType: 'image/jpeg',
          CacheControl: 'private, no-store',
          ServerSideEncryption: 'aws:kms',
        }));
        await fs.unlink(filename);
        uploaded++;
      });
      // Progress is intentionally metadata-only: no file content or personal data.
      console.info(`Private PDF preview progress: ${uploaded}/${pageCount} pages`);
    } finally {await fs.rm(batchDir,{recursive:true,force:true});}
  });
  if (uploaded !== pageCount) throw new Error(`Incomplete PDF preview: uploaded ${uploaded}/${pageCount}`);
}
