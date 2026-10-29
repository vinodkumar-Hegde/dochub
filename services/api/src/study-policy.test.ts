import test from 'node:test';
import assert from 'node:assert/strict';
import {isStudyPageValid,validateStudyStrokes,readProgress} from './study-policy.js';
const good={id:'a1b2c3d4e5f6',kind:'pen',color:'#174fa4',width:4,points:[[0,0],[250,300],[1000,1000]]};
test('normalized student strokes with trusted colors are accepted',()=>assert.equal(validateStudyStrokes([good]),true));
test('rejects markup injection, arbitrary colors and invalid point coordinates',()=>{
  assert.equal(validateStudyStrokes([{...good,color:'url(javascript:alert(1))'}]),false);
  assert.equal(validateStudyStrokes([{...good,points:[[-1,2]]}]),false);
  assert.equal(validateStudyStrokes([{...good,points:[[Infinity,1]]}]),false);
});
test('rejects overly large annotation payloads and duplicate IDs',()=>{
  assert.equal(validateStudyStrokes([good,good]),false);
  assert.equal(validateStudyStrokes([{...good,points:Array.from({length:4001},()=>[1,1])}]),false);
  assert.equal(validateStudyStrokes(Array.from({length:251},(_,i)=>({...good,id:`uniqueid${i}`}))),false);
});
test('read progress clamps to actual page count',()=>{
  assert.equal(readProgress(10,20),50);
  assert.equal(readProgress(40,20),100);
  assert.equal(readProgress(0,0),0);
});
test('page bounds prevent invalid cross-version pagination',()=>{
  assert.equal(isStudyPageValid(2,3),true);
  assert.equal(isStudyPageValid(4,3),false);
  assert.equal(isStudyPageValid(1.5,3),false);
  assert.equal(isStudyPageValid(2001,3000),false);
});
