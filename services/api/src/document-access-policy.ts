/** PDF previews must use scanned versions only. A replacement must not interrupt
 * access to the prior published version until it is explicitly published. */
export type ReadableVersion = { state: string };
export function choosePreviewVersion<T extends ReadableVersion>(
  documentState: string,
  versionsNewestFirst: T[],
  canPreviewUnpublished: boolean,
): T | null {
  if (documentState === 'DELETED') return null;
  const published = versionsNewestFirst.find(v => v.state === 'PUBLISHED') ?? null;
  if (!canPreviewUnpublished) return documentState === 'PUBLISHED' ? published : null;
  return versionsNewestFirst.find(v => v.state === 'READY') ?? published;
}

/** No broad course-only or plan-only access. Every dimension must intersect. */
export function hasExactEnrollment(
  enrollments: ReadonlyArray<{ courseId: string; programmeId: string; subjectId: string; planId: string; validUntil: Date | null; activeFrom?:Date }>,
  document: { courseId: string; programmeId: string; subjectId: string; grants: ReadonlyArray<{ planId: string }> },
  now = new Date(),
): boolean {
  return enrollments.some(e => e.courseId === document.courseId &&
    e.programmeId === document.programmeId && e.subjectId === document.subjectId &&
    document.grants.some(g => g.planId === e.planId) &&
    (!e.activeFrom || e.activeFrom<=now) && (e.validUntil === null || e.validUntil > now));
}

/** Visible navigation subjects are also intersected with an exact active
 * course/programme/plan enrollment. A mapped subject alone is not entitlement. */
export function allowedSubjectIds(
  enrollments: ReadonlyArray<{courseId:string;programmeId:string;subjectId:string;planId:string}>,
  programme: {id:string;courseId:string;locked:boolean;plans:ReadonlyArray<{planId:string}>;subjects:ReadonlyArray<{subjectId:string}>},
): Set<string> {
  if (!programme.locked) return new Set();
  const planIds = new Set(programme.plans.map(v => v.planId));
  const subjectIds = new Set(programme.subjects.map(v => v.subjectId));
  return new Set(enrollments.filter(e => e.courseId === programme.courseId &&
    e.programmeId === programme.id && planIds.has(e.planId) && subjectIds.has(e.subjectId))
    .map(e => e.subjectId));
}
