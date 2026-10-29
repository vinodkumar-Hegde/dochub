import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveTo, folderColors, type MoveSource } from '../../src/folder-interactions.ts';
const source: MoveSource = {id:'doc-1',revision:2,courseId:'c1',programmeId:'p1',subjectId:'s1',folderId:null,canManage:true,locked:false};
const destination = {id:'folder-1',courseId:'c1',programmeId:'p1',subjectId:'s1',locked:false};
test('valid subject-scoped document can be dropped onto another folder',()=>assert.equal(canMoveTo(source,destination),true));
test('cross-course or cross-programme moves are blocked',()=>{
  assert.equal(canMoveTo(source,{...destination,courseId:'c2'}),false);
  assert.equal(canMoveTo(source,{...destination,programmeId:'p2'}),false);
  assert.equal(canMoveTo(source,{...destination,subjectId:'s2'}),false);
});
test('locked and unauthorized source or destination cannot accept moves',()=>{
  assert.equal(canMoveTo({...source,locked:true},destination),false);
  assert.equal(canMoveTo({...source,canManage:false},destination),false);
  assert.equal(canMoveTo(source,{...destination,locked:true}),false);
});
test('same-folder drops are a no-op; moving to root is supported',()=>{
  assert.equal(canMoveTo({...source,folderId:'folder-1'},destination),false);
  assert.equal(canMoveTo({...source,folderId:'folder-1'},{...destination,id:null}),true);
});
test('folder color palette has stable distinct identifiers',()=>{
  assert.equal(new Set(folderColors).size,6);
  assert.ok(folderColors.includes('teal'));
});
