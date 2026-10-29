import test from 'node:test';
import assert from 'node:assert/strict';
import {previewJob,publishablePreview} from './pdf-preview-job-policy.js';

test('all new queued versions use the same automatic worker path, irrespective of page count',()=>{
  assert.equal(previewJob('QUEUED',false,0),'process');
  assert.equal(previewJob('PROCESSING',false,1),'process');
});
test('once previews exist, opening any document never triggers another scan',()=>{
  assert.equal(previewJob('READY',true,1),'skip');
  assert.equal(previewJob('PUBLISHED',true,1),'skip');
});
test('historic missing previews are exceptions, never the normal upload workflow',()=>{
  assert.equal(previewJob('READY',false,1),'repair');
  assert.equal(previewJob('PUBLISHED',false,1),'repair');
});
test('quarantined, failed and exhausted versions cannot be silently repaired',()=>{
  assert.equal(previewJob('QUARANTINED',false,0),'terminal');
  assert.equal(previewJob('FAILED',false,3),'terminal');
  assert.equal(previewJob('PUBLISHED',false,5),'terminal');
});
test('publication consistently requires complete private previews for 1, 10, 215 and 2015 pages',()=>{
  for(const pages of [1,10,215,2015]) {
    assert.equal(publishablePreview('READY',false,pages),false);
    assert.equal(publishablePreview('READY',true,pages),true);
    assert.equal(publishablePreview('PROCESSING',true,pages),false);
  }
  assert.equal(publishablePreview('READY',true,0),false);
});
