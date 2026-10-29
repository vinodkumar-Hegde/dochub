/** Domain rules shared by the authorized subscriber APIs.
 * A subscription is an explicit intersection of course, programme, subject,
 * plan, and optional expiry. Plans never implicitly unlock all subjects. */
export type GrantSelection = {
  courseId: string;
  programmeId: string;
  subjectId: string;
  planId: string;
  validUntil: string | null;
};
export type ProgrammeMapping = {
  id: string;
  courseId: string;
  locked: boolean;
  plans: ReadonlyArray<{ planId: string }>;
  subjects: ReadonlyArray<{ subjectId: string }>;
};

export function validateGrants(
  grants: ReadonlyArray<GrantSelection>,
  mappings: ReadonlyArray<ProgrammeMapping>,
  now = new Date(),
): string | null {
  const byId = new Map(mappings.map(m => [m.id, m]));
  const seen = new Set<string>();
  for (const grant of grants) {
    const mapping = byId.get(grant.programmeId);
    if (!mapping?.locked || mapping.courseId !== grant.courseId) return 'Only approved, locked programmes can grant access';
    if (!mapping.plans.some(p => p.planId === grant.planId)) return 'Plan is not assigned to the selected programme';
    if (!mapping.subjects.some(s => s.subjectId === grant.subjectId)) return 'Subject is not assigned to the selected programme';
    const key = [grant.courseId, grant.programmeId, grant.subjectId, grant.planId].join(':');
    if (seen.has(key)) return 'Duplicate subscription mapping';
    seen.add(key);
    if (grant.validUntil !== null) {
      const end = new Date(grant.validUntil);
      if (!Number.isFinite(end.getTime()) || end <= now) return 'Expiry must be in the future';
    }
  }
  return null;
}

export function composeGrants(input: {
  courseId: string; programmeId: string; subjectIds: string[]; planIds: string[]; validUntil: string | null;
}): GrantSelection[] {
  return input.planIds.flatMap(planId => input.subjectIds.map(subjectId => ({
    courseId: input.courseId, programmeId: input.programmeId, subjectId, planId, validUntil: input.validUntil,
  })));
}
