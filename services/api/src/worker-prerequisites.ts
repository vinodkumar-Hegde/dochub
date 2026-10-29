import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type Runner = (command: string, args: string[], timeoutMs: number) => Promise<void>;

const execute: Runner = async (command, args, timeoutMs) => {
  await execFileAsync(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 });
};

/** Fail before receiving SQS work if validation or current AV signatures are unavailable. */
export async function assertWorkerPrerequisites(run: Runner = execute): Promise<void> {
  try {
    await run('pdfinfo', ['-v'], 10_000);
  } catch (error) {
    throw new Error('PDF worker requires pdfinfo (Poppler). Install and verify Poppler before starting the worker.', { cause: error });
  }

  try {
    await run('pdftoppm', ['-v'], 10_000);
  } catch (error) {
    throw new Error('PDF worker requires pdftoppm for protected page previews. Install Poppler before starting the worker.', { cause: error });
  }

  const dir = await fs.mkdtemp(join(tmpdir(), 'docusend-worker-preflight-'));
  try {
    const sample = join(dir, 'harmless-scan-check.txt');
    await fs.writeFile(sample, 'DOCUSEND ClamAV scanner readiness check\n', { mode: 0o600 });
    try {
      // A real scan, not --version: missing/outdated signature databases fail the scan.
      await run('clamscan', ['--no-summary', sample], 90_000);
    } catch (error) {
      throw new Error('PDF worker requires a functioning ClamAV scanner and loaded signature database. Update signatures before consuming SQS messages.', { cause: error });
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
