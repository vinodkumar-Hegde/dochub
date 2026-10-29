import test from 'node:test';
import assert from 'node:assert/strict';
import {isStudyPageValid} from './study-policy.js';
test('study pages remain valid above legacy 2000 page ceiling',()=>{
  assert.equal(isStudyPageValid(2015,2015),true);
  assert.equal(isStudyPageValid(2016,2015),false);
  assert.equal(isStudyPageValid(0,2015),false);
});
test('only PostgreSQL INTEGER sized page numbers are supported',()=>{
  assert.equal(isStudyPageValid(2_147_483_647,2_147_483_647),true);
  assert.equal(isStudyPageValid(2_147_483_648,2_147_483_648),false);
  assert.equal(isStudyPageValid(Number.NaN,2015),false);
});
