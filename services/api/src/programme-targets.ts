/** Resolve and authorize session and document targets against one approved mapping. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AuthError } from './auth.js';
import { isTaxonomyAvailable } from './academic-lifecycle-policy.js';
import { deriveProgrammeSelection, ProgrammeTargetError, type ProgrammeSelection, type ResolvedProgrammeSelection } from './programme-targets-policy.js';

export async function resolveProgrammeSelection(
  db: PrismaClient | Prisma.TransactionClient,
  selection: ProgrammeSelection,
): Promise<ResolvedProgrammeSelection> {
  const mapping = await db.academicProgramme.findUnique({
    where: { id: selection.programmeId },
    include: {
      course: {select:{hidden:true,accessLocked:true,archivedAt:true}},
      plans: { select: { planId: true, plan: { select: { courseId: true,hidden:true,accessLocked:true,archivedAt:true } } } },
      subjects: { select: { subjectId: true, subject:{select:{hidden:true,accessLocked:true,archivedAt:true}} } },
    },
  });
  if(mapping){
    if(!isTaxonomyAvailable(mapping)||!isTaxonomyAvailable(mapping.course))throw new AuthError(423,'Programme or Course is unavailable');
    if(mapping.plans.some(link=>!isTaxonomyAvailable(link.plan)))throw new AuthError(423,'One of the mapped plans is unavailable');
    if(mapping.subjects.some(link=>!isTaxonomyAvailable(link.subject)))throw new AuthError(423,'One of the mapped subjects is unavailable');
  }
  try { return deriveProgrammeSelection(mapping, selection); }
  catch (error) {
    if (error instanceof ProgrammeTargetError) throw new AuthError(error.statusCode,error.message);
    throw error;
  }
}
