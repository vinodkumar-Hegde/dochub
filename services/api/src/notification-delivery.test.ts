import test from 'node:test';
import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {deliverNotificationBatch} from './notification-delivery.js';
test('delivery rejects unbounded or invalid batch sizes before claiming any jobs',async()=>{
 const db={$transaction:()=>assert.fail('Invalid batch must never claim work')} as unknown as PrismaClient;
 for(const size of [0,-1,1001,1.5,NaN,Infinity])await assert.rejects(deliverNotificationBatch(db,size),/Invalid delivery batch size/);
});
