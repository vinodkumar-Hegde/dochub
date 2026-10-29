import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizedName, nameKey, courseCode, validMapping, canLockMapping } from './academic-policy.js';

test('canonical names avoid accidental whitespace duplicates', () => {
  assert.equal(normalizedName('  NEET   PG  '), 'NEET PG');
  assert.equal(nameKey('  Foundation  Programme  '), 'foundation programme');
  assert.equal(courseCode('NEET PG'), 'NEET-PG');
});
test('mapping allows multiple plans and subjects belonging to their course', () => {
  assert.equal(validMapping('c1', ['p1', 'p2'], ['s1', 's2'], [
    { id: 'p1', courseId: 'c1' }, { id: 'p2', courseId: 'c1' },
  ], [{ id: 's1' }, { id: 's2' }]), true);
});
test('mapping rejects cross-course and unknown associations', () => {
  assert.equal(validMapping('c1', ['p2'], ['s1'], [{ id: 'p2', courseId: 'c2' }], [{ id: 's1' }]), false);
  assert.equal(validMapping('c1', ['p1'], ['missing'], [{ id: 'p1', courseId: 'c1' }], [{ id: 's1' }]), false);
});
test('mapping rejects duplicated associations', () => {
  assert.equal(validMapping('c1', ['p1', 'p1'], ['s1'], [{ id: 'p1', courseId: 'c1' }], [{ id: 's1' }]), false);
});
test('an incomplete programme cannot be locked', () => {
  assert.equal(canLockMapping(0, 1), false);
  assert.equal(canLockMapping(1, 0), false);
  assert.equal(canLockMapping(1, 1), true);
});
