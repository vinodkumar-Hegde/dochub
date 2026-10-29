import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProgrammeSelection, type ProgrammeMapping } from './programme-targets-policy.js';

const mapping:ProgrammeMapping = {
  id:'programme',courseId:'course',locked:true,revision:3,
  plans:[{planId:'plan1',plan:{courseId:'course'}},{planId:'plan2',plan:{courseId:'course'}}],
  subjects:[{subjectId:'subject1'},{subjectId:'subject2'}],
};
const input = {programmeId:'programme',subjectId:'subject1',mappingRevision:3};
test('programme derives its authoritative course and all mapped plans by default',()=>{
  assert.deepEqual(deriveProgrammeSelection(mapping,input),{
    programmeId:'programme',courseId:'course',subjectId:'subject1',planIds:['plan1','plan2'],mappingRevision:3,
  });
});
test('admin may target a smaller approved plan subset',()=>{
  assert.deepEqual(deriveProgrammeSelection(mapping,{...input,planIds:['plan2']}).planIds,['plan2']);
});
test('rejects a stale mapping revision',()=>{
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,mappingRevision:2}),/mapping changed/i);
});
test('rejects mismatched course and subject',()=>{
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,courseId:'other'}),/Course does not belong/i);
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,subjectId:'other'}),/not mapped/i);
});
test('rejects unexpected and duplicate plans',()=>{
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,planIds:['plan3']}),/not mapped/i);
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,planIds:['plan1','plan1']}),/distinct/i);
});
test('rejects unlocked mapping and cross-course plan relationship',()=>{
  assert.throws(()=>deriveProgrammeSelection({...mapping,locked:false},input),/not approved/i);
  assert.throws(()=>deriveProgrammeSelection({...mapping,plans:[{planId:'plan1',plan:{courseId:'wrong'}}]},input),/outside its course/i);
});
test('does not grant access from a nonexistent programme or empty targets',()=>{
  assert.throws(()=>deriveProgrammeSelection(null,input),/not found/i);
  assert.throws(()=>deriveProgrammeSelection(mapping,{...input,planIds:[]}),/one or more/i);
});
