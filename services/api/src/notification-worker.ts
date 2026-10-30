import {setTimeout as wait} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {deliverNotificationBatch} from './notification-delivery.js';
const batchSize=z.coerce.number().int().min(1).max(1000).default(1000).parse(process.env.NOTIFICATION_BATCH_SIZE);
const db=new PrismaClient();let stopping=false;
process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
try{
 await db.$queryRaw`SELECT 1`;console.info('Notification delivery worker ready');
 while(!stopping){try{if(!await deliverNotificationBatch(db,batchSize))await wait(1000)}catch(error){console.error('Notification batch failed',error);await wait(1000)}}
}finally{await db.$disconnect()}
