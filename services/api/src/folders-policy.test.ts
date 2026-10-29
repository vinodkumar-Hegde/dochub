import test from 'node:test';import assert from 'node:assert/strict';import {isStudentDocumentVisible} from './folders-policy.js';
test('hidden files are not exposed to students',()=>assert.equal(isStudentDocumentVisible({hidden:true,locked:false}),false));
test('locked files are not exposed to students',()=>assert.equal(isStudentDocumentVisible({hidden:false,locked:true}),false));
test('hidden or locked folder denies access to its files',()=>{assert.equal(isStudentDocumentVisible({hidden:false,locked:false,folder:{hidden:true,locked:false}}),false);assert.equal(isStudentDocumentVisible({hidden:false,locked:false,folder:{hidden:false,locked:true}}),false);});
test('visible and unlocked document is eligible for entitlement check',()=>assert.equal(isStudentDocumentVisible({hidden:false,locked:false,folder:{hidden:false,locked:false}}),true));
