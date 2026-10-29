import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceMutationDecision, canSubmitStudentResponse } from './student-attendance-policy.js';

test('one submitted response cannot change before or after a session', () => {
  assert.equal(attendanceMutationDecision(null,'WILL_ATTEND'),'create');
  assert.equal(attendanceMutationDecision('WILL_ATTEND','WILL_ATTEND'),'same');
  assert.equal(attendanceMutationDecision('WILL_ATTEND','NOT_AVAILABLE'),'conflict');
  assert.equal(attendanceMutationDecision('WATCH_RECORDING','WILL_ATTEND'),'conflict');
});
test('cancelled, unpublished and postponed sessions cannot accept a new declaration', () => {
  assert.equal(canSubmitStudentResponse('SCHEDULED'),true);
  assert.equal(canSubmitStudentResponse('COMPLETED'),true);
  assert.equal(canSubmitStudentResponse('CANCELLED'),false);
  assert.equal(canSubmitStudentResponse('POSTPONED'),false);
  assert.equal(canSubmitStudentResponse('DRAFT'),false);
});
