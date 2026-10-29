import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, UserRole } from '@prisma/client';
import { AuthError, assertRole, type Principal } from './auth.js';
import { isTaxonomyAvailable } from './academic-lifecycle-policy.js';
import { canLockMapping, courseCode, nameKey, normalizedName, validMapping } from './academic-policy.js';

const uuid = z.string().uuid();
const nameInput = z.object({ name: z.string().trim().min(2).max(120) }).strict();
const linkedNameInput = nameInput.extend({ courseId: uuid });
const mappingInput = z.object({
  revision: z.number().int().nonnegative(),
  planIds: z.array(uuid).max(500),
  subjectIds: z.array(uuid).max(500),
}).strict();
const lockInput = z.object({ locked: z.boolean(), revision: z.number().int().nonnegative() }).strict();
const idInput = z.object({ id: uuid });
const readRoles: UserRole[] = ['SUPER_ADMIN', 'CONTENT_MANAGER'];

function duplicate(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    throw new AuthError(409, 'A record with this name or code already exists');
  }
  throw error;
}

async function catalog(db: PrismaClient) {
  const [courses, plans, subjects, programmes, faculty] = await Promise.all([
    db.academicCourse.findMany({ orderBy: { name: 'asc' } }),
    db.academicPlan.findMany({ orderBy: { name: 'asc' } }),
    db.academicSubject.findMany({ orderBy: { name: 'asc' } }),
    db.academicProgramme.findMany({
      include: { plans: { select: { planId: true } }, subjects: { select: { subjectId: true } } },
      orderBy: { name: 'asc' },
    }),
    db.academicFaculty.findMany({orderBy:{name:'asc'}}),
  ]);
  return {
    courses: courses.map(c => ({ id: c.id, code: c.code, name: c.name, revision:c.revision,hidden:c.hidden,accessLocked:c.accessLocked,archivedAt:c.archivedAt })),
    plans: plans.map(p => ({ id: p.id, courseId: p.courseId, name: p.name, revision:p.revision,hidden:p.hidden,accessLocked:p.accessLocked,archivedAt:p.archivedAt })),
    subjects: subjects.map(s => ({ id: s.id, name: s.name, emoji: '', color: '#f8fafc', revision:s.revision,hidden:s.hidden,accessLocked:s.accessLocked,archivedAt:s.archivedAt })),
    programmes: programmes.map(p => ({
      id: p.id, courseId: p.courseId, name: p.name,
      locked: p.locked, revision: p.revision, hidden:p.hidden,accessLocked:p.accessLocked,archivedAt:p.archivedAt,
      planIds: p.plans.map(link => link.planId),
      subjectIds: p.subjects.map(link => link.subjectId),
    })),
    faculty: faculty.map(f=>({id:f.id,name:f.name,revision:f.revision,hidden:f.hidden,accessLocked:f.accessLocked,archivedAt:f.archivedAt})),
  };
}

export function registerAcademic(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (req: import('fastify').FastifyRequest) => Promise<Principal>,
): void {
  app.get('/v1/academic/catalog', async req => {
    const principal = await authenticate(req);
    assertRole(principal, readRoles);
    return catalog(db);
  });

  app.post('/v1/academic/courses', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { name: raw } = nameInput.parse(req.body);
    const name = normalizedName(raw), code = courseCode(raw);
    if (!code) throw new AuthError(400, 'Course name must contain letters or numbers');
    try {
      const created = await db.$transaction(async tx => {
        const c = await tx.academicCourse.create({ data: { name, nameKey: nameKey(name), code } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: c.id, action: 'ACADEMIC_COURSE_CREATED', details: { name: c.name, code } } });
        return c;
      });
      return reply.code(201).send({ id: created.id });
    } catch (error) { duplicate(error); }
  });

  app.post('/v1/academic/plans', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { name: raw, courseId } = linkedNameInput.parse(req.body);
    if (!isTaxonomyAvailable(await db.academicCourse.findUnique({ where: { id: courseId } }))) throw new AuthError(423, 'Course is unavailable');
    const name = normalizedName(raw);
    try {
      const created = await db.$transaction(async tx => {
        const p = await tx.academicPlan.create({ data: { name, nameKey: nameKey(name), courseId } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: p.id, action: 'ACADEMIC_PLAN_CREATED', details: { name: p.name, courseId } } });
        return p;
      });
      return reply.code(201).send({ id: created.id });
    } catch (error) { duplicate(error); }
  });

  app.post('/v1/academic/subjects', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { name: raw } = nameInput.parse(req.body);
    const name = normalizedName(raw);
    try {
      const created = await db.$transaction(async tx => {
        const s = await tx.academicSubject.create({ data: { name, nameKey: nameKey(name) } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: s.id, action: 'ACADEMIC_SUBJECT_CREATED', details: { name: s.name } } });
        return s;
      });
      return reply.code(201).send({ id: created.id });
    } catch (error) { duplicate(error); }
  });

  app.post('/v1/academic/programmes', async (req, reply) => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { name: raw, courseId } = linkedNameInput.parse(req.body);
    if (!isTaxonomyAvailable(await db.academicCourse.findUnique({ where: { id: courseId } }))) throw new AuthError(423, 'Course is unavailable');
    const name = normalizedName(raw);
    try {
      const created = await db.$transaction(async tx => {
        const p = await tx.academicProgramme.create({ data: { name, nameKey: nameKey(name), courseId } });
        await tx.auditEvent.create({ data: { actorId: principal.userId, targetId: p.id, action: 'ACADEMIC_PROGRAMME_CREATED', details: { name, courseId } } });
        return p;
      });
      return reply.code(201).send({ id: created.id });
    } catch (error) { duplicate(error); }
  });

  app.put('/v1/academic/programmes/:id/mapping', async req => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { id } = idInput.parse(req.params);
    const input = mappingInput.parse(req.body);
    await db.$transaction(async tx => {
      const programme = await tx.academicProgramme.findUnique({ where: { id } });
      if (!programme) throw new AuthError(404, 'Programme not found');
      if (programme.locked) throw new AuthError(423, 'Programme is locked');
      if(!isTaxonomyAvailable(programme) || !isTaxonomyAvailable(await tx.academicCourse.findUnique({where:{id:programme.courseId}})))throw new AuthError(423,'Course or Programme unavailable');
      const [plans, subjects] = await Promise.all([
        tx.academicPlan.findMany({ where: { id: { in: input.planIds },hidden:false,accessLocked:false,archivedAt:null }, select: { id: true, courseId: true } }),
        tx.academicSubject.findMany({ where: { id: { in: input.subjectIds },hidden:false,accessLocked:false,archivedAt:null }, select: { id: true } }),
      ]);
      if (!validMapping(programme.courseId, input.planIds, input.subjectIds, plans, subjects)) {
        throw new AuthError(400, 'Every plan must belong to the programme course and every subject must exist; duplicate mappings are not allowed');
      }
      const update = await tx.academicProgramme.updateMany({
        where: { id, revision: input.revision, locked: false },
        data: { revision: { increment: 1 } },
      });
      if (update.count !== 1) throw new AuthError(409, 'Mapping changed elsewhere. Reload before editing');
      await tx.programmePlan.deleteMany({ where: { programmeId: id } });
      await tx.programmeSubject.deleteMany({ where: { programmeId: id } });
      if (input.planIds.length) await tx.programmePlan.createMany({ data: input.planIds.map(planId => ({ programmeId: id, planId })) });
      if (input.subjectIds.length) await tx.programmeSubject.createMany({ data: input.subjectIds.map(subjectId => ({ programmeId: id, subjectId })) });
      await tx.auditEvent.create({ data: {
        actorId: principal.userId, targetId: id, action: 'ACADEMIC_MAPPING_UPDATED',
        details: { fromRevision: input.revision, planIds: input.planIds, subjectIds: input.subjectIds },
      } });
    });
    return { status: 'saved' };
  });

  app.put('/v1/academic/programmes/:id/lock', async req => {
    const principal = await authenticate(req); assertRole(principal, ['SUPER_ADMIN']);
    const { id } = idInput.parse(req.params);
    const { locked, revision } = lockInput.parse(req.body);
    await db.$transaction(async tx => {
      const programme = await tx.academicProgramme.findUnique({
        where: { id }, include: { _count: { select: { plans: true, subjects: true } } },
      });
      if (!programme) throw new AuthError(404, 'Programme not found');
      if(!isTaxonomyAvailable(programme))throw new AuthError(423,'Programme is unavailable');
      if (programme.revision !== revision) throw new AuthError(409, 'Mapping changed elsewhere. Reload before editing');
      if (programme.locked === locked) return;
      if (locked && !canLockMapping(programme._count.plans, programme._count.subjects)) {
        throw new AuthError(409, 'Map at least one plan and one subject before locking');
      }
      const updated = await tx.academicProgramme.updateMany({
        where: { id, revision, locked: !locked }, data: { locked, revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AuthError(409, 'Mapping changed elsewhere. Reload before editing');
      await tx.auditEvent.create({ data: {
        actorId: principal.userId, targetId: id,
        action: locked ? 'ACADEMIC_MAPPING_LOCKED' : 'ACADEMIC_MAPPING_UNLOCKED', details: { fromRevision: revision },
      } });
    });
    return { status: locked ? 'locked' : 'unlocked' };
  });
}
