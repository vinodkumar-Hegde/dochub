import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { composeGrants, validateGrants } from './subscriber-policy.js';
const mapped = { id: 'programme', courseId: 'course', locked: true, plans: [{planId:'plan-1'},{planId:'plan-2'}], subjects: [{subjectId:'anatomy'},{subjectId:'physiology'}] };
const one = { courseId:'course', programmeId:'programme', subjectId:'anatomy', planId:'plan-1', validUntil:null };
test('explicit mapped enrollment is accepted', () => assert.equal(validateGrants([one],[mapped]),null));
test('cross-course and unknown plan or subject access is rejected', () => {
  for(const bad of [{...one,courseId:'other'},{...one,planId:'other'},{...one,subjectId:'other'}]) assert.ok(validateGrants([bad],[mapped]));
});
test('an unlocked programme cannot confer access', () => assert.ok(validateGrants([one],[{...mapped,locked:false}])));
test('duplicated grants are rejected', () => assert.equal(validateGrants([one,one],[mapped]),'Duplicate subscription mapping'));
test('expired grants are rejected', () => assert.equal(validateGrants([{...one,validUntil:'2020-01-01T00:00:00.000Z'}],[mapped],new Date('2026-10-29T00:00:00Z')),'Expiry must be in the future'));
test('multi-plan, multi-subject enrollment creates exact intersection only', () => {
  const grants = composeGrants({courseId:'course',programmeId:'programme',subjectIds:['anatomy','physiology'],planIds:['plan-1','plan-2'],validUntil:null});
  assert.equal(grants.length,4);
  assert.equal(validateGrants(grants,[mapped]),null);
});
