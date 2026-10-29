import type { StudentAttendanceIntent } from '@prisma/client';
import type { SessionStatus } from './sessions-policy.js';

/** A submitted response is immutable; it expresses intention, not verified participation. */
export function canSubmitStudentResponse(status: SessionStatus,endAt:Date,now=new Date()): boolean {
  return status === 'SCHEDULED' && endAt>now;
}
export function attendanceMutationDecision(
  existing: StudentAttendanceIntent | null,
  requested: StudentAttendanceIntent,
): 'create' | 'same' | 'conflict' {
  if (existing === null) return 'create';
  return existing === requested ? 'same' : 'conflict';
}
