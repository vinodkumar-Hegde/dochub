import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnrolledForDocument } from './documents.js';
const doc = {courseId: 'c1',programmeId:'pg1',subjectId:'anatomy',grants:[{planId:'p1'}]};
const valid = {courseId:'c1',programmeId:'pg1',subjectId:'anatomy',planId:'p1',validUntil:null};
test('entitlement requires exact course programme subject plan intersection', () => {
  assert.equal(isEnrolledForDocument([valid], doc), true);
  for (const field of ['courseId','programmeId','subjectId','planId'] as const) {
    assert.equal(isEnrolledForDocument([{...valid,[field]:'other'}],doc), false, field);
  }
});
test('expired enrollment is denied', () => {
  assert.equal(isEnrolledForDocument([{...valid,validUntil:new Date('2020-01-01')}],doc,new Date('2026-10-28')),false);
});
test('unmapped and empty enrollments are denied', () => {
  assert.equal(isEnrolledForDocument([],doc),false);
  assert.equal(isEnrolledForDocument([valid],{...doc,grants:[]}),false);
});
