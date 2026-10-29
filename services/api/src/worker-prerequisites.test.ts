import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWorkerPrerequisites } from './worker-prerequisites.js';

test('worker checks PDF tool and performs actual antivirus scan before polling', async () => {
  const calls: string[] = [];
  await assertWorkerPrerequisites(async (command, args) => {
    calls.push(command);
    if (command === 'clamscan') {
      assert.equal(args[0], '--no-summary');
      assert.equal(args[1], '--fail-if-cvd-older-than=3');
      assert.match(args[2] ?? '', /harmless-scan-check\.txt$/);
    }
  });
  assert.deepEqual(calls, ['pdfinfo', 'pdftoppm', 'clamscan']);
});

test('missing PDF validation tools stop startup before scanner is invoked', async () => {
  let calls = 0;
  await assert.rejects(
    assertWorkerPrerequisites(async () => { calls++; throw new Error('ENOENT'); }),
    /requires pdfinfo/,
  );
  assert.equal(calls, 1);
});

test('ClamAV signature failures stop worker startup', async () => {
  await assert.rejects(
    assertWorkerPrerequisites(async (command) => {
      if (command === 'clamscan') throw new Error('No supported database files found');
    }),
    /requires a functioning ClamAV scanner and loaded signature database/,
  );
});

test('missing protected preview renderer stops worker before polling', async () => {
  await assert.rejects(
    assertWorkerPrerequisites(async command => {
      if (command === 'pdftoppm') throw new Error('ENOENT');
    }),
    /requires pdftoppm/,
  );
});
