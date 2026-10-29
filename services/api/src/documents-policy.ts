/** Upload constraints are enforced server-side; UI selections are never trusted. */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 10_000;

export function partCount(sizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error('Invalid PDF size');
  return Math.ceil(sizeBytes / MULTIPART_PART_BYTES);
}

export function validUploadMapping(
  programme: {
    id: string;
    courseId: string;
    locked: boolean;
    plans: Array<{ planId: string }>;
    subjects: Array<{ subjectId: string }>;
  } | null,
  input: { courseId: string; programmeId: string; subjectId: string; planIds: string[] },
): boolean {
  if (!programme || !programme.locked || programme.id !== input.programmeId || programme.courseId !== input.courseId) return false;
  if (input.planIds.length === 0 || input.planIds.length !== new Set(input.planIds).size) return false;
  const assignedPlans = new Set(programme.plans.map(x => x.planId));
  return programme.subjects.some(x => x.subjectId === input.subjectId) &&
    input.planIds.every(id => assignedPlans.has(id));
}
