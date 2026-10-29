import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubscriberCsv} from '../../src/subscriber-csv.ts';
const head='Student name,Email,Phone number,Course,Activation Date,Expiry Date';
test('CSV carries individual activation and expiry dates',()=>{
  const csv=`${head}\nStudent One,one@example.com,9999999999,NEET PG,2026-11-01,2027-10-31\n`;
  const result=parseSubscriberCsv(csv);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.rows[0]?.activationDate,'2026-11-01');
  assert.equal(result.rows[0]?.expiryDate,'2027-10-31');
});
test('CSV rejects impossible and inverted dates',()=>{
  assert.match(parseSubscriberCsv(`${head}\nStudent One,one@example.com,9999999999,NEET PG,2027-02-29,2027-10-31`).errors.join(' '),/Activation Date/);
  assert.match(parseSubscriberCsv(`${head}\nStudent One,one@example.com,9999999999,NEET PG,2027-10-31,2026-11-01`).errors.join(' '),/precedes/);
});
test('existing four-column exports remain compatible',()=>{
  const result=parseSubscriberCsv('Student name,Email,Phone number,Course\nStudent One,one@example.com,9999999999,NEET PG');
  assert.equal(result.errors.length,0);
  assert.equal(result.rows[0]?.activationDate,undefined);
});
