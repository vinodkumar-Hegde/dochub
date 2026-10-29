import { z } from 'zod';

const originSchema=z.string().url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&value===url.origin;},'Use an exact HTTP(S) origin without a path or trailing slash');
const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  SQS_QUEUE_URL: z.string().url(),
  CORS_ORIGIN: originSchema,
  SES_FROM_EMAIL: z.string().email().optional(),
  STUDENT_APP_ORIGIN: z.string().url().optional(),
  PREVIEW_CDN_ORIGIN: z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:' && url.pathname==='/' && !url.search && !url.hash && !url.username && !url.password;},'CDN origin must be an HTTPS origin').optional(),
  PREVIEW_CDN_KEY_PAIR_ID: z.string().min(1).optional(),
  PREVIEW_CDN_PRIVATE_KEY_FILE: z.string().min(1).optional(),
  PREVIEW_CDN_TTL_SECONDS: z.coerce.number().int().min(15).max(120).default(60),
  PDF_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  PDF_UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  PDF_VERIFICATION_POLICY: z.string().min(1).default('clamav-poppler-v1'),
  PDF_WORKER_IMAGE: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  PORT: z.coerce.number().int().positive().default(3001),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(10 * 1024 ** 3),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const normalized={...env};
  for(const key of ['SES_FROM_EMAIL','STUDENT_APP_ORIGIN','PREVIEW_CDN_ORIGIN','PREVIEW_CDN_KEY_PAIR_ID','PREVIEW_CDN_PRIVATE_KEY_FILE','PDF_WORKER_IMAGE'])if(normalized[key]==='')delete normalized[key];
  const cfg=configSchema.parse(normalized);
  const cdn=[cfg.PREVIEW_CDN_ORIGIN,cfg.PREVIEW_CDN_KEY_PAIR_ID,cfg.PREVIEW_CDN_PRIVATE_KEY_FILE];
  if(cdn.some(Boolean)&&!cdn.every(Boolean))throw new Error('All preview CDN settings are required together');
  return cfg;
}
