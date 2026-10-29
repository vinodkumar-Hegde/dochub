import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDownloadOriginal, effectiveDocumentPermissions, previewPageKey, studentReaderMode } from './document-permissions.js';

test('download and print are disabled by default; students do not get a PDF viewer URL', () => {
  const flags = { allowDownload: false, allowPrint: false };
  assert.equal(canDownloadOriginal(false, flags), false);
  assert.equal(studentReaderMode(false), 'pages');
  assert.equal(flags.allowPrint, false);
});
test('only an explicit admin policy change enables downloading; print is independent', () => {
  assert.equal(canDownloadOriginal(false, { allowDownload: false, allowPrint: true }), false);
  assert.equal(canDownloadOriginal(false, { allowDownload: true, allowPrint: false }), true);
  assert.equal(canDownloadOriginal(true, { allowDownload: false, allowPrint: false }), true);
  assert.equal(studentReaderMode(true), 'pdf');
});
test('preview keys use version ids and validated page numbers, never user-supplied file paths', () => {
  const version = '57a4144d-2492-4488-bd23-0acbf10aa5bd';
  assert.equal(previewPageKey(version, 1), `private/previews/${version}/page-000001.jpg`);
  assert.throws(() => previewPageKey('../secret', 1));
  assert.throws(() => previewPageKey(version, 0));
  assert.throws(() => previewPageKey(version, 1.5));
});

// Folder restrictions must never override a PDF-level denial or grant unintended access.
test('folder and file both must permit download and print', () => {
  const lockedDown = {allowDownload: false, allowPrint: false};
  assert.deepEqual(effectiveDocumentPermissions({...lockedDown, folder:{allowDownload:true,allowPrint:true}}), lockedDown);
  assert.deepEqual(effectiveDocumentPermissions({allowDownload:true,allowPrint:true,folder:{allowDownload:false,allowPrint:true}}), {allowDownload:false,allowPrint:true});
  assert.deepEqual(effectiveDocumentPermissions({allowDownload:true,allowPrint:true,folder:{allowDownload:true,allowPrint:false}}), {allowDownload:true,allowPrint:false});
  assert.deepEqual(effectiveDocumentPermissions({allowDownload:true,allowPrint:true,folder:{allowDownload:true,allowPrint:true}}), {allowDownload:true,allowPrint:true});
  assert.deepEqual(effectiveDocumentPermissions({allowDownload:true,allowPrint:false}), {allowDownload:true,allowPrint:false});
  assert.equal(canDownloadOriginal(false,effectiveDocumentPermissions({allowDownload:true,allowPrint:false,folder:{allowDownload:false,allowPrint:true}})),false);
});
