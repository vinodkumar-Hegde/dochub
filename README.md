# DocHub

React/TypeScript learning workspace with a Fastify API, PostgreSQL/Prisma, email OTP authentication, private S3 storage and an SQS PDF worker.

Start with [the DevOps handoff](docs/operations/DEVOPS-HANDOFF.md) for Docker commands, environment variables, AWS prerequisites, migrations, admin creation, endpoints, deployment and rollback. [Review results](docs/verification/CODE-REVIEW.md) distinguish automated checks from deployment checks.

## Local development

Requires Node.js 22, PostgreSQL 16 and separately configured AWS resources.

```sh
npm ci
npm ci --prefix services/api
cp .env.example .env.local
cp services/api/.env.example services/api/.env
# Edit both environment files before proceeding.
cd services/api
npm run db:generate
npm run db:migrate
node --env-file=.env --import tsx src/bootstrap-admin.ts
node --env-file=.env --import tsx src/server.ts
```

In another terminal, run `npm run dev` from the repository root. Start the notification worker separately with `node --env-file=.env --import tsx src/notification-worker.ts` from `services/api`; it delivers queued in-app notifications. Run the PDF worker separately with `node --env-file=.env --import tsx src/worker.ts` from `services/api`; it needs Poppler and current ClamAV signatures. Docker provides those system dependencies. Application login is email + OTP for all roles; no password, default admin or legacy Cognito setup is required.

Do not commit real environment files, credentials, database backups, Terraform state or signing keys. `VITE_*` values are public browser configuration.
