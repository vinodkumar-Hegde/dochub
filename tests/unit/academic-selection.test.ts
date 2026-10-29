import test from 'node:test';
import assert from 'node:assert/strict';
import { programmesForCourse, selectedProgrammeInCourse } from '../../src/academic-selection.ts';

const programmes = [
  { id: 'p-1', name: 'MIQ', courseId: 'course-1' },
  { id: 'p-2', name: 'MIQ', courseId: 'course-2' },
  { id: 'p-3', name: 'CPR', courseId: 'course-1' },
];

test('same programme name under distinct courses remains unambiguous', () => {
  assert.deepEqual(programmesForCourse(programmes, 'course-1').map(x => x.id), ['p-1','p-3']);
  assert.deepEqual(programmesForCourse(programmes, 'course-2').map(x => x.id), ['p-2']);
});

test('without a chosen course programme selector offers no options', () => {
  assert.deepEqual(programmesForCourse(programmes, ''), []);
});

test('cross-course and empty programme selections are rejected', () => {
  assert.equal(selectedProgrammeInCourse(programmes, 'course-1', 'p-2'), undefined);
  assert.equal(selectedProgrammeInCourse(programmes, 'course-1', ''), undefined);
  assert.equal(selectedProgrammeInCourse(programmes, '', 'p-1'), undefined);
  assert.equal(selectedProgrammeInCourse(programmes, 'course-2', 'p-2')?.id, 'p-2');
});
