import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {normalizeSubscriberEmail} from './subscriber-email.js';

/** Explicit deployment command; never runs on application startup. */
const email=z.string().trim().email().max(254).transform(normalizeSubscriberEmail).parse(process.env.ADMIN_EMAIL);
const displayName=z.string().trim().min(2).max(120).parse(process.env.ADMIN_NAME??'Administrator');
const db=new PrismaClient();
try{
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 2))::text`;
  const matches=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "User" WHERE lower(btrim(email))=${email}`;
  const existing=matches[0]?await tx.user.findUnique({where:{id:matches[0].id},include:{roles:true}}):null;
  if(existing&&!existing.roles.some(r=>r.role==='SUPER_ADMIN'))throw new Error('Email belongs to an existing non-admin account. Use a dedicated administrator address.');
  if(existing&&!existing.enabled)throw new Error('Administrator is disabled. Review account status before enabling access.');
  const user=existing??await tx.user.create({data:{identitySub:randomUUID(),email,displayName,roles:{create:{role:'SUPER_ADMIN'}}}});
  if(!existing)await tx.auditEvent.create({data:{actorId:user.id,targetId:user.id,action:'ADMIN_BOOTSTRAPPED',details:{method:'deployment-command'}}});
  console.log(existing?'Administrator already configured.':'Administrator created. Sign in using email and OTP.');
 });
}finally{await db.$disconnect()}
