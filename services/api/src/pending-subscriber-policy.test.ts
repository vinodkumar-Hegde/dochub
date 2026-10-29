import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existingSubscriberConflict, pendingIdentitySub } from './pending-subscriber-policy.js';

const uuid = 'a914a00f-3b96-48b5-a05a-1d7e98875ec1';
test('pending identities cannot match Cognito UUID subjects', () => {
  assert.equal(pendingIdentitySub(uuid), `pending:${uuid}`);
  assert.notEqual(pendingIdentitySub(uuid), uuid);
  assert.throws(() => pendingIdentitySub('not-an-identity'));
});
test('new student emails may be registered without an identity provider', () => {
  assert.equal(existingSubscriberConflict([]), null);
});
test('existing student subscriber can be assigned additional grants', () => {
  assert.equal(existingSubscriberConflict([{enabled:true,roles:[{role:'STUDENT'}]}]), null);
});
test('disabled accounts cannot be used for new enrollments', () => {
  assert.match(existingSubscriberConflict([{enabled:false,roles:[{role:'STUDENT'}]}])??'', /disabled/);
});
test('employee identity is never given a student role by matching email', () => {
  assert.match(existingSubscriberConflict([{enabled:true,roles:[{role:'SUPER_ADMIN'}]}])??'', /non-student/);
});
test('duplicate identities are blocked rather than ambiguously linked', () => {
  assert.match(existingSubscriberConflict([
    {enabled:true,roles:[{role:'STUDENT'}]},
    {enabled:true,roles:[{role:'STUDENT'}]},
  ])??'', /Multiple accounts/);
});
