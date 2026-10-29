import { PrismaClient } from '@prisma/client';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Config } from './config.js';

export async function dispatchOutbox(db: PrismaClient, sqs: SQSClient, cfg: Config) {
  const events = await db.outboxEvent.findMany({ where: { dispatchedAt: null }, orderBy: { createdAt: 'asc' }, take: 50 });
  for (const event of events) {
    // At-least-once delivery; the worker transaction uses a lease to deduplicate.
    await sqs.send(new SendMessageCommand({ QueueUrl: cfg.SQS_QUEUE_URL, MessageBody: JSON.stringify({ id: event.id, topic: event.topic, ...event.payload as object }) }));
    await db.outboxEvent.updateMany({ where: { id: event.id, dispatchedAt: null }, data: { dispatchedAt: new Date() } });
  }
}
