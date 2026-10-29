import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriberImportIssues} from './subscriber-import-policy.js';
const course={name:'NEET PG',code:'NEETPG'};
test('duplicate uploaded emails ignore case/space and identify the earlier CSV row',()=>{
 const issues=subscriberImportIssues([{email:' Student@Example.com '},{email:'student@example.COM'}],[],course);
 assert.equal(issues.length,1);assert.equal(issues[0]?.row,3);assert.equal(issues[0]?.code,'DUPLICATE_UPLOAD');assert.match(issues[0]!.message,/row 2/);
});
test('every existing identity is rejected independently of upload duplicates',()=>{
 const issues=subscriberImportIssues([{email:'old@example.com'},{email:'NEW@example.com'},{email:'old@example.com'}],[' OLD@example.com '],course);
 assert.deepEqual(issues.map(issue=>[issue.row,issue.code]),[[2,'EXISTING_EMAIL'],[4,'DUPLICATE_UPLOAD'],[4,'EXISTING_EMAIL']]);
});
test('legacy course columns are ignored while invalid dates produce row-specific issues',()=>{
 const issues=subscriberImportIssues([{email:'one@example.com',course:'MBBS',activationDate:'2026-12-01'}],[],course,'2026-10-29T00:00:00Z','2026-11-01T00:00:00Z');
 assert.deepEqual(issues.map(issue=>issue.code),['INVALID_DATES']);
});
test('new students with course codes and per-row date overrides pass',()=>{
 assert.deepEqual(subscriberImportIssues([{email:'new@example.com',course:' neetpg ',activationDate:'2026-11-01',expiryDate:'2027-10-31'}],[],course),[]);
});
