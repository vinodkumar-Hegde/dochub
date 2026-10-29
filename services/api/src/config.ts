import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  SQS_QUEUE_URL: z.string().url(),
  COGNITO_ISSUER: z.string().url(),
  COGNITO_AUDIENCE: z.string().min(1),
  CORS_ORIGIN: z.string().url(),
  SES_FROM_EMAIL: z.string().email().optional(),
  STUDENT_APP_ORIGIN: z.string().url().optional(),
  PDF_WORKER_IMAGE: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(10 * 1024 ** 3),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse(env);
}
