import type { AcademicCatalog } from './academic-client';

type Programme = AcademicCatalog['programmes'][number];
type Plan = Pick<AcademicCatalog['plans'][number], 'id' | 'name' | 'courseId'>;
type Subject = AcademicCatalog['subjects'][number];

/** UI projection only; upload authorization is always checked again by the API. */
export function getProgrammeReadiness(
  programme: Programme | undefined,
  plans: readonly Plan[],
  subjects: readonly Pick<Subject, 'id' | 'name'>[],
): { ready: boolean; message: string } {
  if (!programme) return { ready: false, message: 'Select a programme to continue.' };
  if (!plans.length || !subjects.length) return {
    ready: false,
    message: 'Map at least one course plan and one subject, then lock the programme in Academic Mapping.',
  };
  if (!programme.locked) return {
    ready: false,
    message: 'Programme mapping is not locked. Approve and lock it in Academic Mapping before uploading.',
  };
  return { ready: true, message: '' };
}
