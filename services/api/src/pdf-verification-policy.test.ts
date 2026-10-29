import test from 'node:test';
import assert from 'node:assert/strict';
import {reusablePdfVerification} from './pdf-verification-policy.js';
const verified={objectVersionId:'immutable-version',verifiedObjectVersionId:'immutable-version',verifiedAt:new Date(),verificationPolicy:'v1',pageCount:215};
test('render retries reuse the scan of the exact pinned object',()=>assert.equal(reusablePdfVerification(verified,'v1'),true));
test('changed objects, missing evidence and policy changes require a new scan',()=>{
  for(const patch of [{objectVersionId:null},{objectVersionId:'null'},{objectVersionId:'replacement'},{verifiedAt:null},{verifiedObjectVersionId:null},{verificationPolicy:'old'},{pageCount:0}])assert.equal(reusablePdfVerification({...verified,...patch},'v1'),false);
  assert.equal(reusablePdfVerification(verified,'v2'),false);
});
