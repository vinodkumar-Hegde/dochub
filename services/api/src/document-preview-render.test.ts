import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewBatches} from './document-preview-render.js';

test('single page is rendered exactly once', () => {
  assert.deepEqual(planPreviewBatches(1), [[1,1]]);
});
test('boundary pages do not get duplicated or skipped', () => {
  assert.deepEqual(planPreviewBatches(25), [[1,12],[13,24],[25,25]]);
});
test('215 pages are fully covered', () => {
  const b = planPreviewBatches(215);
  assert.deepEqual(b.at(-1), [205,215]);
  assert.equal(b.reduce((sum,[lo,hi]) => sum + hi-lo+1,0), 215);
});
test('2015 pages have complete coverage, beyond previous frontend cap', () => {
  const b = planPreviewBatches(2015);
  assert.deepEqual(b.at(-1), [2005,2015]);
  assert.equal(b.reduce((sum,[lo,hi]) => sum + hi-lo+1,0), 2015);
});
test('invalid page count fails closed', () => {
  for (const pages of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => planPreviewBatches(pages));
  }
});
