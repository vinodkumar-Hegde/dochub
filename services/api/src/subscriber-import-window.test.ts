import test from 'node:test';
import assert from 'node:assert/strict';
import {validImportDate,resolveImportWindow} from './subscriber-import-window.js';

test('calendar dates validate strict ISO including leap years',()=>{
  assert.equal(validImportDate('2028-02-29'),true);
  assert.equal(validImportDate('2027-02-29'),false);
  assert.equal(validImportDate('29/10/2026'),false);
});
test('per-row dates override shared defaults and use IST boundaries',()=>{
  const result=resolveImportWindow({activationDate:'2026-11-01',expiryDate:'2027-10-31'},'2026-10-29T00:00:00Z',null);
  assert.equal(result?.activeFrom.toISOString(),'2026-10-31T18:30:00.000Z');
  assert.equal(result?.validUntil?.toISOString(),'2027-10-31T18:29:59.999Z');
});
test('empty row dates use selected defaults; no expiry is allowed',()=>{
  const result=resolveImportWindow({},'2026-11-01T00:00:00Z',null);
  assert.equal(result?.activeFrom.toISOString(),'2026-11-01T00:00:00.000Z');
  assert.equal(result?.validUntil,null);
});
test('expiry earlier than activation is rejected',()=>{
  assert.equal(resolveImportWindow({activationDate:'2026-11-02',expiryDate:'2026-11-01'},undefined,null),null);
});
