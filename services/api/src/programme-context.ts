/**
 * DocHub — shared, read-only academic context resolver.
 * Additively register from services/api/src/server.ts:
 *   registerProgrammeContext(app, db, authenticate);
 *
 * This endpoint does NOT grant access to a student. Mutations still validate
 * mappings inside their own database transactions, and student read endpoints
 * independently enforce enrollment, publication and content permissions.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthError, assertRole, type Principal } from './auth.js';
import { isTaxonomyAvailable } from './academic-lifecycle-policy.js';

const idParams = z.object({ id: z.string().uuid() }).strict();
const adminRoles = ['SUPER_ADMIN', 'CONTENT_MANAGER'] as const;

export function registerProgrammeContext(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<Principal>,
): void {
  // A Programme always has exactly one Course in the CURRENT model.
  // Plans and Subjects are many-to-many junctions.
  app.get('/v1/academic/programmes/:id/context', async request => {
    const principal = await authenticate(request);
    assertRole(principal, [...adminRoles]);
    const { id } = idParams.parse(request.params);
    const programme = await db.academicProgramme.findUnique({
      where: { id },
      select: {
        id: true, name: true, courseId: true, locked: true, revision: true,hidden:true,accessLocked:true,archivedAt:true,
        course: { select: { id: true, name: true, code: true,hidden:true,accessLocked:true,archivedAt:true } },
        plans: { select: { plan: { select: { id: true, courseId: true, name: true,hidden:true,accessLocked:true,archivedAt:true } } } },
        subjects: { select: { subject: { select: { id: true, name: true,hidden:true,accessLocked:true,archivedAt:true } } } },
      },
    });
    if (!programme) throw new AuthError(404, 'Programme not found');
    if(!isTaxonomyAvailable(programme)||!isTaxonomyAvailable(programme.course))throw new AuthError(423,'Programme or Course is unavailable');
    const plans = programme.plans.map(link => link.plan).filter(isTaxonomyAvailable);
    if (plans.some(plan => plan.courseId !== programme.courseId)) {
      throw new AuthError(409, 'Programme includes a plan from a different course');
    }
    return {
      programme: {
        id: programme.id,
        name: programme.name,
        locked: programme.locked,
        mappingRevision: programme.revision,
      },
      // An array makes the API shape convenient for dropdown components, but
      // CURRENTLY contains exactly one Course; not a multi-course association.
      courses: [programme.course],
      plans: plans.sort((a, b) => a.name.localeCompare(b.name)),
      subjects: programme.subjects.map(link => link.subject).filter(isTaxonomyAvailable)
        .sort((a, b) => a.name.localeCompare(b.name)),
      canPublish: programme.locked && plans.length > 0 && programme.subjects.some(link=>isTaxonomyAvailable(link.subject)) && plans.length===programme.plans.length && programme.subjects.every(link=>isTaxonomyAvailable(link.subject)),
    };
  });

  // A Plan may be mapped to MULTIPLE Programmes; never guess one arbitrarily.
  app.get('/v1/academic/plans/:id/programmes', async request => {
    const principal = await authenticate(request);
    assertRole(principal, [...adminRoles]);
    const { id } = idParams.parse(request.params);
    const plan = await db.academicPlan.findUnique({
      where: { id },
      select: {
        id: true, courseId: true, name: true,
        programmes: { select: { programme: { select: {
          id: true, name: true, courseId: true, locked: true, revision: true,
        } } } },
      },
    });
    if (!plan) throw new AuthError(404, 'Plan not found');
    const programmes = plan.programmes.map(link => link.programme);
    if (programmes.some(programme => programme.courseId !== plan.courseId)) {
      throw new AuthError(409, 'Plan is mapped to a programme outside its course');
    }
    return {
      plan: { id: plan.id, name: plan.name, courseId: plan.courseId },
      programmes: programmes.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
