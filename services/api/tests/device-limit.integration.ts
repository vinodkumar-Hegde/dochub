import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import Fastify from 'fastify';import {PrismaClient,type Prisma} from '@prisma/client';import {registerEmailOtp} from '../src/email-otp.js';import {loadConfig} from '../src/config.js';
const db=new PrismaClient(),rollback=new Error('rollback device fixtures');
test('two active device sessions are allowed; a third is rejected until a slot is freed',async()=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname));
 try{await db.$transaction(async tx=>{
  const cfg=loadConfig(),email=`devices-${randomUUID()}@example.com`,user=await tx.user.create({data:{identitySub:randomUUID(),email,roles:{create:{role:'SUPER_ADMIN'}}}});
  const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
  let code='';const app=Fastify();registerEmailOtp(app,scopedDb,cfg,async(_email,otp)=>{code=otp});
  const devices=Array.from({length:3},()=>`dochub_device=${randomBytes(32).toString('base64url')}`);
  const request=async(device:string)=>{const r=await app.inject({method:'POST',url:'/auth/otp/request',headers:{origin:cfg.CORS_ORIGIN,cookie:device},payload:{email}});assert.equal(r.statusCode,200,r.body);return {id:r.json().challengeId,code}};
  const verify=(device:string,id:string,otp:string)=>app.inject({method:'POST',url:'/auth/otp/verify',headers:{origin:cfg.CORS_ORIGIN,cookie:device},payload:{challengeId:id,code:otp}});
  const login=async(device:string)=>{const challenge=await request(device);const r=await verify(device,challenge.id,challenge.code);assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0]!};
  try{
   await login(devices[0]!);const second=await login(devices[1]!);assert.equal(await tx.appSession.count({where:{userId:user.id,revokedAt:null}}),2);
   await login(devices[0]!);assert.equal(await tx.appSession.count({where:{userId:user.id,revokedAt:null}}),2,'same device must reuse its slot');
   const third=await request(devices[2]!);let r=await verify(devices[2]!,third.id,third.code);assert.equal(r.statusCode,409);assert.match(r.json().message,/Two devices/);assert.equal(r.headers['set-cookie'],undefined);
   r=await app.inject({method:'POST',url:'/auth/logout',headers:{origin:cfg.CORS_ORIGIN,cookie:second},payload:{}});assert.equal(r.statusCode,200);
   r=await verify(devices[2]!,third.id,third.code);assert.equal(r.statusCode,200,r.body);assert.equal(await tx.appSession.count({where:{userId:user.id,revokedAt:null}}),2);
   await tx.appSession.updateMany({where:{userId:user.id,revokedAt:null},data:{lastSeenAt:new Date(Date.now()-31*60000)}});
   await login(`dochub_device=${randomBytes(32).toString('base64url')}`);
  }finally{await app.close()}throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}
});
