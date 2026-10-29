import test from 'node:test';
import assert from 'node:assert/strict';
import {isTaxonomyAvailable,isSubscriptionActive,subscriberState,validSubscriptionWindow} from './academic-lifecycle-policy.js';
const now=new Date('2026-10-29T08:00:00Z');
test('archived, hidden and access-locked taxonomy is unavailable',()=>{
  assert.equal(isTaxonomyAvailable({hidden:false,accessLocked:false,archivedAt:null}),true);
  assert.equal(isTaxonomyAvailable({hidden:true,accessLocked:false,archivedAt:null}),false);
  assert.equal(isTaxonomyAvailable({hidden:false,accessLocked:true,archivedAt:null}),false);
  assert.equal(isTaxonomyAvailable({hidden:false,accessLocked:false,archivedAt:now}),false);
});
test('activation and expiry are enforced at every access check, without cron',()=>{
  assert.equal(isSubscriptionActive({activeFrom:new Date('2026-10-30'),validUntil:null},now),false);
  assert.equal(isSubscriptionActive({activeFrom:new Date('2026-10-01'),validUntil:new Date('2026-10-29T08:00:00Z')},now),false);
  assert.equal(isSubscriptionActive({activeFrom:new Date('2026-10-01'),validUntil:new Date('2026-11-01')},now),true);
});
test('profile status reflects active grants, scheduled starts and expiry',()=>{
  assert.equal(subscriberState(false,[],now),'LOCKED');
  assert.equal(subscriberState(true,[{activeFrom:new Date('2026-11-01'),validUntil:null}],now),'SCHEDULED');
  assert.equal(subscriberState(true,[{activeFrom:new Date('2026-01-01'),validUntil:new Date('2026-10-01')}],now),'EXPIRED');
  assert.equal(subscriberState(true,[{activeFrom:new Date('2026-01-01'),validUntil:null}],now),'ACTIVE');
  assert.equal(validSubscriptionWindow(new Date('2026-11-01'),new Date('2026-10-01')),false);
});
