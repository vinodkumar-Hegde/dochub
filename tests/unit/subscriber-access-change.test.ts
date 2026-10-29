import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSubscriberGrants} from '../../src/subscriber-access-change.ts';
const old={programmeId:'old-programme',courseId:'old-course',subjectId:'old-subject',planId:'old-plan'};
const another={programmeId:'other-programme',courseId:'other-course',subjectId:'other-subject',planId:'other-plan'};
const replacement={programmeId:'new-programme',courseId:'new-course',subjectId:'new-subject',planId:'new-plan'};
test('changing a student programme replaces old course/subject/plan grants',()=>{
  assert.deepEqual(nextSubscriberGrants([old,another],[replacement],'replace',replacement.programmeId),[replacement]);
});
test('explicit multi-programme mode retains unrelated grants but replaces selected programme',()=>{
  const changed={...another,subjectId:'updated-subject'};
  assert.deepEqual(nextSubscriberGrants([old,another],[changed],'keep-other-programmes',another.programmeId),[old,changed]);
});
test('the replacement mode handles an empty prior subscription',()=>{
  assert.deepEqual(nextSubscriberGrants([], [replacement], 'replace',replacement.programmeId),[replacement]);
});
