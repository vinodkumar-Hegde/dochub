import test from 'node:test';
import assert from 'node:assert/strict';
import { isCognitoAccessToken } from './auth.js';
test('only Cognito access token from expected public client is accepted', () => {
  assert.equal(isCognitoAccessToken({token_use:'access',client_id:'client',sub:'subject'},'client'),true);
  assert.equal(isCognitoAccessToken({token_use:'id',client_id:'client',sub:'subject',aud:'client'},'client'),false);
  assert.equal(isCognitoAccessToken({token_use:'access',client_id:'other',sub:'subject'},'client'),false);
  assert.equal(isCognitoAccessToken({token_use:'access',client_id:'client'},'client'),false);
});
