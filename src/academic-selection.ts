/** Course-scoped programme selection. IDs, never names, identify programmes. */
export function programmesForCourse<T extends { id: string; courseId: string }>(
  programmes: readonly T[], courseId: string,
): T[] {
  return courseId ? programmes.filter(item => item.courseId === courseId) : [];
}

/** Reject a programme ID from another course even if names are identical. */
export function selectedProgrammeInCourse<T extends { id: string; courseId: string }>(
  programmes: readonly T[], courseId: string, programmeId: string,
): T | undefined {
  if (!courseId || !programmeId) return undefined;
  return programmes.find(item => item.id === programmeId && item.courseId === courseId);
}
