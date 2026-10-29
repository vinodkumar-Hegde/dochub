import test from 'node:test';
import assert from 'node:assert/strict';
import {hasExactEnrollment, choosePreviewVersion} from '../../services/api/src/document-access-policy.ts';
const oldGrant={courseId:'course-A',programmeId:'programme-A',subjectId:'subject-A',planId:'plan-A',validUntil:null};
const newGrant={courseId:'course-B',programmeId:'programme-B',subjectId:'subject-B',planId:'plan-B',validUntil:null};
const oldDocument={...oldGrant,grants:[{planId:'plan-A'}]};
const newDocument={...newGrant,grants:[{planId:'plan-B'}]};
test('an old PDF loses read authorization immediately after a course/programme replacement',()=>{
  assert.equal(hasExactEnrollment([oldGrant],oldDocument),true);
  assert.equal(hasExactEnrollment([newGrant],oldDocument),false);
  assert.equal(hasExactEnrollment([newGrant],newDocument),true);
});
test('extra existing course, programme, subject or plan grants never imply cross-course access',()=>{
  assert.equal(hasExactEnrollment([newGrant],{...oldDocument,grants:[{planId:'plan-B'}]}),false);
});
test('a student never reads READY-only replacement when prior published version exists',()=>{
  const available=[{state:'READY',id:'unapproved'},{state:'PUBLISHED',id:'approved'}];
  assert.equal(choosePreviewVersion('PUBLISHED',available,false)?.id,'approved');
  assert.equal(choosePreviewVersion('PUBLISHED',available,true)?.id,'unapproved');
});
test('student preview requires a published version',()=>{
  assert.equal(choosePreviewVersion('PUBLISHED',[{state:'READY',id:'not-published'}],false),null);
});
