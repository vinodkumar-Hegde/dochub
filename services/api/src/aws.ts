import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { Config } from './config.js';
export function awsClients(config: Config) {
  return {
    s3: new S3Client({ region: config.AWS_REGION }),
    sqs: new SQSClient({ region: config.AWS_REGION }),
  };
}
