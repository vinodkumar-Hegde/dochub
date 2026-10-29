import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProgrammeReadiness } from '../../src/upload-mapping.ts';

const p = { id:'programme', name:'CPR', courseId:'course', planIds:['plan'], subjectIds:['subject'], locked:true, revision:2 };
const plans = [{ id:'plan', name:'Complete', courseId:'course' }];
const subjects = [{ id:'subject', name:'Anatomy', emoji:'', color:'' }];

test('requires a chosen programme', () => {
  assert.equal(getProgrammeReadiness(undefined,plans,subjects).ready,false);
});
test('blocks unmapped programme even if locked', () => {
  assert.equal(getProgrammeReadiness(p,[],subjects).ready,false);
  assert.equal(getProgrammeReadiness(p,plans,[]).ready,false);
});
test('unlocked programme is visible but cannot be uploaded to', () => {
  const result = getProgrammeReadiness({...p,locked:false},plans,subjects);
  assert.equal(result.ready,false);
  assert.match(result.message,/not locked/i);
});
test('approved programme with mapped plans and subjects is ready', () => {
  assert.equal(getProgrammeReadiness(p,plans,subjects).ready,true);
});
