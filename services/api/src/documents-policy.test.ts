import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MAX_MULTIPART_PARTS, MULTIPART_PART_BYTES, partCount, validUploadMapping } from './documents-policy.js';
const p = { id:'programme', courseId:'course', locked: true, plans:[{planId:'p1'},{planId:'p2'}], subjects:[{subjectId:'s1'}] };
const input={ courseId:'course',programmeId:'programme',subjectId:'s1',planIds:['p1','p2'] };
test('uploads require locked approved programme and course',()=>{
  assert.equal(validUploadMapping(p,input),true);
  assert.equal(validUploadMapping({...p,locked:false},input),false);
  assert.equal(validUploadMapping(p,{...input,courseId:'another'}),false);
});
test('uploads cannot grant unrelated, duplicated or unmapped plans and subjects',()=>{
  assert.equal(validUploadMapping(p,{...input,planIds:['p3']}),false);
  assert.equal(validUploadMapping(p,{...input,planIds:['p1','p1']}),false);
  assert.equal(validUploadMapping(p,{...input,subjectId:'s2'}),false);
  assert.equal(validUploadMapping(p,{...input,planIds:[]}),false);
});
test('multipart parts use 8 MiB and the last part may be smaller',()=>{
  assert.equal(partCount(1),1);
  assert.equal(partCount(MULTIPART_PART_BYTES),1);
  assert.equal(partCount(MULTIPART_PART_BYTES+1),2);
  assert.ok(MAX_MULTIPART_PARTS>=partCount(10*1024**3));
  assert.throws(()=>partCount(0));
});
