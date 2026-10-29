import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceMutationDecision, canSubmitStudentResponse } from './student-attendance-policy.js';

test('one submitted response cannot change before or after a session', () => {
  assert.equal(attendanceMutationDecision(null,'WILL_ATTEND'),'create');
  assert.equal(attendanceMutationDecision('WILL_ATTEND','WILL_ATTEND'),'same');
  assert.equal(attendanceMutationDecision('WILL_ATTEND','NOT_AVAILABLE'),'conflict');
  assert.equal(attendanceMutationDecision('WATCH_RECORDING','WILL_ATTEND'),'conflict');
});
test('new responses are accepted only for scheduled sessions before the end',()=>{
 const now=new Date('2026-10-30T10:00:00Z'),later=new Date('2026-10-30T11:00:00Z');
 assert.equal(canSubmitStudentResponse('SCHEDULED',later,now),true);
 for(const status of ['COMPLETED','CANCELLED','POSTPONED','DRAFT'] as const)assert.equal(canSubmitStudentResponse(status,later,now),false);
 assert.equal(canSubmitStudentResponse('SCHEDULED',now,now),false);
 assert.equal(canSubmitStudentResponse('SCHEDULED',new Date('2026-10-29'),now),false);
});
