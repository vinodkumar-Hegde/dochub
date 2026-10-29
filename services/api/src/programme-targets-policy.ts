/** Shared pure authorization rules for programme-scoped content and sessions. */
export class ProgrammeTargetError extends Error {
  constructor(public readonly statusCode:number,message:string){super(message);this.name='ProgrammeTargetError';}
}
export type ProgrammeMapping = {
  id: string;
  courseId: string;
  locked: boolean;
  revision: number;
  plans: Array<{ planId: string; plan: { courseId: string } }>;
  subjects: Array<{ subjectId: string }>;
};

export type ProgrammeSelection = {
  programmeId: string;
  courseId?: string;
  subjectId: string;
  planIds?: string[];
  mappingRevision?: number;
};

export type ResolvedProgrammeSelection = {
  programmeId: string;
  courseId: string;
  subjectId: string;
  planIds: string[];
  mappingRevision: number;
};

/** Pure policy: never trust courseId or plan eligibility supplied by a browser. */
export function deriveProgrammeSelection(
  mapping: ProgrammeMapping | null,
  selection: ProgrammeSelection,
): ResolvedProgrammeSelection {
  if (!mapping || mapping.id !== selection.programmeId) throw new ProgrammeTargetError(404, 'Programme not found');
  if (!mapping.locked) throw new ProgrammeTargetError(409, 'Programme mapping is not approved');
  if (selection.mappingRevision !== undefined && selection.mappingRevision !== mapping.revision) {
    throw new ProgrammeTargetError(409, 'Programme mapping changed; reload the form');
  }
  if (selection.courseId && selection.courseId !== mapping.courseId) {
    throw new ProgrammeTargetError(422, 'Course does not belong to this programme');
  }
  if (mapping.plans.some(link => link.plan.courseId !== mapping.courseId)) {
    throw new ProgrammeTargetError(409, 'Programme contains a plan outside its course');
  }
  if (!mapping.subjects.some(link => link.subjectId === selection.subjectId)) {
    throw new ProgrammeTargetError(422, 'Subject is not mapped to this programme');
  }
  const approvedIds = mapping.plans.map(link => link.planId);
  const chosen = selection.planIds ?? approvedIds;
  if (!chosen.length || chosen.length > 100 || new Set(chosen).size !== chosen.length) {
    throw new ProgrammeTargetError(422, 'Choose one or more distinct approved plans');
  }
  const approved = new Set(approvedIds);
  if (!chosen.every(id => approved.has(id))) {
    throw new ProgrammeTargetError(422, 'Selected plan is not mapped to this programme');
  }
  return {
    programmeId: mapping.id,
    courseId: mapping.courseId,
    subjectId: selection.subjectId,
    planIds: [...chosen],
    mappingRevision: mapping.revision,
  };
}
