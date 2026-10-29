import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedSubjectIds, choosePreviewVersion, hasExactEnrollment } from './document-access-policy.js';

const prior = { id: 'v1', state: 'PUBLISHED' };
const unverified = { id: 'v2', state: 'PROCESSING' };
const ready = { id: 'v2', state: 'READY' };

test('students cannot preview READY, failed or deleted materials', () => {
  assert.equal(choosePreviewVersion('READY', [ready], false), null);
  assert.equal(choosePreviewVersion('DELETED', [prior], false), null);
  assert.equal(choosePreviewVersion('FAILED', [prior], false), null);
  assert.equal(choosePreviewVersion('PUBLISHED', [unverified, prior], false)?.id, 'v1');
});
test('administrators can preview a scanned READY version before publication', () => {
  assert.equal(choosePreviewVersion('READY', [ready], true)?.id, 'v2');
  assert.equal(choosePreviewVersion('PUBLISHED', [ready, prior], true)?.id, 'v2');
});
test('published version stays readable during unverified replacement', () => {
  assert.equal(choosePreviewVersion('PUBLISHED', [unverified, prior], true)?.id, 'v1');
  assert.equal(choosePreviewVersion('PUBLISHED', [unverified, prior], false)?.id, 'v1');
  assert.equal(choosePreviewVersion('PUBLISHED', [unverified], true), null);
});
test('entitlement denies mismatched programme, subject, course or plan and expired grants', () => {
  const e = { courseId: 'c', programmeId: 'pr', subjectId: 's', planId: 'p', validUntil: null };
  const document = { courseId: 'c', programmeId: 'pr', subjectId: 's', grants: [{ planId: 'p' }] };
  assert.equal(hasExactEnrollment([e], document), true);
  for (const field of ['courseId', 'programmeId', 'subjectId', 'planId'] as const) {
    assert.equal(hasExactEnrollment([{ ...e, [field]: 'not-mapped' }], document), false, field);
  }
  assert.equal(hasExactEnrollment([{ ...e, validUntil: new Date('2021-01-01') }], document, new Date('2026-10-29')), false);
  assert.equal(hasExactEnrollment([], document), false);
});

test('student catalogue excludes unrelated plan and programme subjects and unlocked mappings', () => {
  const p = {id:'pr',courseId:'c',locked:true,plans:[{planId:'p'}],subjects:[{subjectId:'a'},{subjectId:'b'}]};
  const subscriptions = [
    {courseId:'c',programmeId:'pr',planId:'p',subjectId:'a'},
    {courseId:'c',programmeId:'pr',planId:'other',subjectId:'b'},
    {courseId:'c',programmeId:'other',planId:'p',subjectId:'b'},
  ];
  assert.deepEqual([...allowedSubjectIds(subscriptions,p)],['a']);
  assert.deepEqual([...allowedSubjectIds(subscriptions,{...p,locked:false})],[]);
});
