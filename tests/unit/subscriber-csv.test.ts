import test from 'node:test';import assert from 'node:assert/strict';
import {parseSubscriberCsv} from '../../src/subscriber-csv.ts';
test('quoted names and commas parsed',()=>{const result=parseSubscriberCsv('Student name,Email,Phone number,Course\n"Kumar, V",A@EXAMPLE.COM,+919999999999,NEET PG');assert.equal(result.errors.length,0);assert.equal(result.rows[0]?.name,'Kumar, V');assert.equal(result.rows[0]?.email,'a@example.com');});
test('duplicate emails are rejected',()=>{const csv='Student name,Email,Phone number,Course\nStudent One,a@example.com,9999999999,NEET PG\nStudent Two,A@example.com,9999999999,NEET PG';assert.match(parseSubscriberCsv(csv).errors.join(' '),/duplicate/i);});
