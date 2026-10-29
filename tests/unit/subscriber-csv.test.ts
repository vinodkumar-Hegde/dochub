import test from 'node:test';import assert from 'node:assert/strict';
import {parseSubscriberCsv} from '../../src/subscriber-csv.ts';
test('quoted names and commas parsed',()=>{const result=parseSubscriberCsv('Student name,Email,Phone number,Course\n"Kumar, V",A@EXAMPLE.COM,+919999999999,NEET PG');assert.equal(result.errors.length,0);assert.equal(result.rows[0]?.name,'Kumar, V');assert.equal(result.rows[0]?.email,'a@example.com');});
test('duplicate emails are rejected',()=>{const csv='Student name,Email,Phone number,Course\nStudent One,a@example.com,9999999999,NEET PG\nStudent Two,A@example.com,9999999999,NEET PG';assert.match(parseSubscriberCsv(csv).errors.join(' '),/duplicate/i);});

test('blank optional phones are omitted rather than rejected by the API',()=>{
 const result=parseSubscriberCsv('Student name,Email,Phone number,Course\nStudent One,new@example.com,,NEET PG');
 assert.deepEqual(result.errors,[]);assert.equal(result.rows[0]?.phone,undefined);
});
test('duplicate headers and mismatched columns cannot silently corrupt an import',()=>{
 assert.match(parseSubscriberCsv('Student name,Email,Email,Phone number,Course\nStudent One,a@example.com,b@example.com,,NEET PG').errors.join(' '),/duplicate column/i);
 assert.match(parseSubscriberCsv('Student name,Email,Phone number,Course\nStudent One,a@example.com,,NEET PG,unexpected').errors.join(' '),/column count/i);
});
test('replacement invalid files cannot be mistaken for valid student rows',()=>{
 assert.match(parseSubscriberCsv('not a student CSV').errors.join(' '),/Missing header/);
 assert.match(parseSubscriberCsv('Student name,Email,Phone number,Course\n"Unclosed,a@example.com,,NEET PG').errors.join(' '),/Unclosed/);
});
test('course and phone columns are optional; legacy course cells do not override admin selection',()=>{
 const minimal=parseSubscriberCsv('Student name,Email\nStudent One,one@example.com');
 assert.deepEqual(minimal.errors,[]);
 const legacy=parseSubscriberCsv('Student name,Email,Course\nStudent One,one@example.com,Old course');
 assert.deepEqual(legacy.errors,[]);assert.equal(legacy.rows[0]?.course,undefined);
});
test('national and international phones accept common separators and long formatted numbers',()=>{
 for(const phone of ['09876543210','+91 98765 43210','0044 7700 900123','+1 (202) 555-0123','+49 (0) 170 / 123.4567','+358 (40) 123 456 789']){
  const parsed=parseSubscriberCsv(`Student name,Email,Phone number\nStudent One,one@example.com,${phone}`);
  assert.deepEqual(parsed.errors,[],phone);assert.equal(parsed.rows[0]?.phone,phone);
 }
 for(const phone of ['--- ()','123','+123+456789','call me']){
  assert.match(parseSubscriberCsv(`Student name,Email,Phone number\nStudent One,one@example.com,${phone}`).errors.join(' '),/invalid phone/);
 }
});

import {subscriberImportCandidates} from '../../src/subscriber-csv.ts';
test('partial import excludes invalid and repeated rows while preserving source row numbers',()=>{
 const parsed=parseSubscriberCsv('Student name,Email,Phone number\nStudent One,one@example.com,9876543210\nBad Email,invalid,9876543210\nDuplicate,ONE@example.com,9876543210\nStudent Four,four@example.com,+44 7700 900123');
 const candidates=subscriberImportCandidates(parsed.rows,parsed.errors);
 assert.deepEqual(candidates.map(candidate=>[candidate.sourceRow,candidate.row.email]),[[2,'one@example.com'],[5,'four@example.com']]);
});
test('file-wide errors never allow uploading a partial interpretation of the CSV',()=>{
 const student={name:'Student One',email:'one@example.com'};
 assert.deepEqual(subscriberImportCandidates([student],['Import at most 200 students per CSV. Split larger files.']),[]);
 assert.deepEqual(subscriberImportCandidates([student],['Row 2: invalid phone number']),[]);
 assert.equal(subscriberImportCandidates([student],[]).length,1);
});
