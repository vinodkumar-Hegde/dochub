/** Domain invariants shared by endpoints and change-focused unit tests. */
export function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
export function nameKey(value: string): string {
  return normalizedName(value).toLocaleLowerCase('en');
}
export function courseCode(value: string): string {
  return normalizedName(value).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}
export function validMapping(
  courseId: string,
  planIds: string[],
  subjectIds: string[],
  plans: { id: string; courseId: string }[],
  subjects: { id: string }[],
): boolean {
  if (new Set(planIds).size !== planIds.length || new Set(subjectIds).size !== subjectIds.length) return false;
  const planSet = new Set(plans.filter(p => p.courseId === courseId).map(p => p.id));
  const subjectSet = new Set(subjects.map(s => s.id));
  return planIds.every(id => planSet.has(id)) && subjectIds.every(id => subjectSet.has(id));
}
export function canLockMapping(planCount: number, subjectCount: number): boolean {
  return planCount > 0 && subjectCount > 0;
}
