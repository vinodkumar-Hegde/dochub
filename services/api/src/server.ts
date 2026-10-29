import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { awsClients } from './aws.js';
import { createAuthenticator, AuthError } from './auth.js';
import { registerDocuments } from './documents.js';
import { registerAcademic } from './academic.js';
import { registerAcademicAdministration } from './academic-admin.js';
import { registerSubscribers } from './subscribers.js';
import { registerStudentAuthentication } from './student-auth.js';
import { registerFolders } from './folders.js';
import { registerSessions } from './sessions.js';
import { registerProgrammeContext } from './programme-context.js';
import { dispatchOutbox } from './outbox.js';

const cfg = loadConfig();
const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.token', 'res.headers.set-cookie'] }, bodyLimit: 256 * 1024 });
const db = new PrismaClient();
const { s3, sqs } = awsClients(cfg);
await app.register(helmet);
await app.register(cors, { origin: cfg.CORS_ORIGIN, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['authorization','content-type'] });
app.setErrorHandler((err, req, reply) => {
  const reportedStatus = err !== null && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
    ? err.statusCode : undefined;
  const status = err instanceof AuthError ? err.statusCode : err instanceof ZodError ? 400
    : reportedStatus !== undefined && reportedStatus >= 400 && reportedStatus < 500 ? reportedStatus : 500;
  if (status === 500) req.log.error(err);
  reply.code(status).send({ code: status, message: status === 500 ? 'Internal server error' : err instanceof ZodError ? 'Invalid request' : err instanceof AuthError ? err.message : status !== 500 ? 'Invalid request' : 'Internal server error' });
});
app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async () => { await db.$queryRaw`SELECT 1`; return { status: 'ready' }; });
const authenticateEmployee = createAuthenticator(cfg, db);
const authenticateStudent = registerStudentAuthentication(app, db, cfg);
// Cookie sessions are confined to STUDENT role; employees still use Cognito bearer tokens.
const authenticate = (request: import('fastify').FastifyRequest) =>
  request.headers.authorization ? authenticateEmployee(request) : authenticateStudent(request);
app.get('/auth/me', async (request) => {
  const principal = await authenticate(request);
  return { userId: principal.userId, roles: principal.roles, displayName: principal.displayName ?? null };
});
registerDocuments(app, db, s3, cfg, authenticate);
registerAcademic(app, db, authenticate);
registerAcademicAdministration(app, db, authenticate);
registerProgrammeContext(app, db, authenticate);
registerSubscribers(app, db, cfg, authenticate);
registerFolders(app, db, s3, cfg, authenticate);
registerSessions(app, db, authenticate);
const interval = setInterval(() => dispatchOutbox(db, sqs, cfg).catch(err => app.log.error({ err }, 'Outbox dispatch failed')), 5000);
const shutdown = async () => { clearInterval(interval); await app.close(); await db.$disconnect(); s3.destroy(); sqs.destroy(); };
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
