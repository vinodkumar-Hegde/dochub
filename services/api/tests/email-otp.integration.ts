import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';import {PrismaClient,type Prisma} from '@prisma/client';
import {registerEmailOtp} from '../src/email-otp.js';import {registerSubscribers} from '../src/subscribers.js';import {loadConfig} from '../src/config.js';
const db=new PrismaClient(),rollback=new Error('rollback OTP fixtures');
test('unified email OTP for students and admins',async t=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local database only');
 try{await db.$transaction(async tx=>{
  const cfg=loadConfig(),key=randomUUID();
  const course=await tx.academicCourse.create({data:{name:'OTP course',nameKey:key,code:key}}),subject=await tx.academicSubject.create({data:{name:'OTP subject',nameKey:key}});
  const plan=await tx.academicPlan.create({data:{name:'Full access plan',nameKey:key,courseId:course.id}});
  const programme=await tx.academicProgramme.create({data:{name:'OTP programme',nameKey:key,courseId:course.id,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
  const student=await tx.user.create({data:{identitySub:randomUUID(),email:`student-${key}@example.com`,displayName:'OTP Student',roles:{create:{role:'STUDENT'}},enrollments:{create:{courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:plan.id,activeFrom:new Date(Date.now()-86400000),validUntil:null}}}});
  const admin=await tx.user.create({data:{identitySub:randomUUID(),email:`admin-${key}@example.com`,roles:{create:{role:'SUPER_ADMIN'}}}});
  const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
  const codes=new Map<string,string>(),app=Fastify();const authorize=registerEmailOtp(app,scopedDb,cfg,async(email,code)=>{codes.set(email,code)});
  registerSubscribers(app,scopedDb,cfg,authorize);app.get('/protected',async req=>authorize(req));app.post('/protected',async req=>authorize(req));
  const headers={origin:cfg.CORS_ORIGIN};
  const request=(email:string)=>app.inject({method:'POST',url:'/auth/otp/request',headers,payload:{email}});
  const verify=(challengeId:string,code:string)=>app.inject({method:'POST',url:'/auth/otp/verify',headers,payload:{challengeId,code}});
  const session=(cookie:string)=>app.inject({url:'/auth/session',headers:{cookie}});
  const cookieOf=(r:{headers:Record<string,unknown>})=>String(r.headers['set-cookie']).split(';')[0]!;
  let studentCookie='',adminCookie='';
  try{
   await t.test('students sign in without credentials; account includes named courses and plans',async()=>{
    const r=await request(` ${student.email!.toUpperCase()} `);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().code,undefined);
    const challenge=await tx.loginChallenge.findUniqueOrThrow({where:{id:r.json().challengeId}});assert.notEqual(challenge.codeHash,codes.get(student.email!));
    const login=await verify(challenge.id,codes.get(student.email!)!);assert.equal(login.statusCode,200,login.body);studentCookie=cookieOf(login);
    assert.deepEqual(login.json().roles,['STUDENT']);assert.equal(login.json().subscriptions[0].courseName,'OTP course');assert.equal(login.json().subscriptions[0].planName,'Full access plan');
    assert.match(String(login.headers['set-cookie']),/HttpOnly; SameSite=Strict/);assert.equal(await tx.studentCredential.findUnique({where:{userId:student.id}}),null);
    assert.equal((await session(studentCookie)).statusCode,200);assert.equal((await verify(challenge.id,codes.get(student.email!)!)).statusCode,401);
   });
   await t.test('the same OTP flow authorizes admins without granting admin access to students',async()=>{
    const r=await request(admin.email!),login=await verify(r.json().challengeId,codes.get(admin.email!)!);assert.equal(login.statusCode,200,login.body);adminCookie=cookieOf(login);
    assert.deepEqual(login.json().roles,['SUPER_ADMIN']);assert.equal((await app.inject({method:'POST',url:'/protected',headers:{cookie:adminCookie,origin:'https://elsewhere.example'},payload:{}})).statusCode,403);assert.equal((await app.inject({method:'POST',url:'/protected',headers:{cookie:adminCookie,...headers},payload:{}})).statusCode,200);assert.equal((await app.inject({url:'/v1/admin/subscribers',headers:{cookie:adminCookie}})).statusCode,200);
    assert.equal((await app.inject({url:'/v1/admin/subscribers',headers:{cookie:studentCookie}})).statusCode,403);
   });
   await t.test('expiry and manual locks preserve OTP login and profile but block features',async()=>{
    await tx.enrollment.updateMany({where:{userId:student.id},data:{validUntil:new Date(Date.now()-1)}});
    assert.equal((await session(studentCookie)).json().featuresLocked,true);assert.equal((await app.inject({url:'/protected',headers:{cookie:studentCookie}})).statusCode,403);
    await tx.user.update({where:{id:student.id},data:{enabled:false}});
    const r=await request(student.email!),login=await verify(r.json().challengeId,codes.get(student.email!)!);assert.equal(login.statusCode,200,login.body);studentCookie=cookieOf(login);assert.equal(login.json().status,'LOCKED');
   });
   await t.test('unknown and disabled admin emails receive a generic response without email delivery',async()=>{
    const address=`unknown-${randomUUID()}@example.com`,r=await request(address);assert.equal(r.statusCode,200);assert.equal(codes.has(address),false);assert.equal((await verify(r.json().challengeId,'000000')).statusCode,401);
    const disabled=await tx.user.create({data:{identitySub:randomUUID(),email:`disabled-${key}@example.com`,enabled:false,roles:{create:{role:'SUPER_ADMIN'}}}});
    const response=await request(disabled.email!);assert.equal(response.json().message,r.json().message);assert.equal(codes.has(disabled.email!),false);
   });
   await t.test('resend invalidates old codes; attempts are committed and expired codes fail',async()=>{
    let r=await request(admin.email!);const old=r.json().challengeId,oldCode=codes.get(admin.email!)!;
    r=await request(admin.email!);assert.equal((await verify(old,oldCode)).statusCode,401);
    const id=r.json().challengeId,correct=codes.get(admin.email!)!,wrong=correct==='000000'?'111111':'000000';
    for(let i=0;i<5;i++)assert.equal((await verify(id,wrong)).statusCode,401);
    assert.equal((await tx.loginChallenge.findUniqueOrThrow({where:{id}})).attempts,5);assert.equal((await verify(id,correct)).statusCode,401);
    r=await request(admin.email!);await tx.loginChallenge.update({where:{id:r.json().challengeId},data:{expiresAt:new Date(Date.now()-1)}});assert.equal((await verify(r.json().challengeId,codes.get(admin.email!)!)).statusCode,401);
   });
   await t.test('profile email updates revoke old OTP sessions and unused challenges',async()=>{
    const r=await app.inject({method:'PATCH',url:`/v1/admin/subscribers/${student.id}`,headers:{...headers,cookie:adminCookie},payload:{revision:0,email:`changed-${key}@example.com`}});assert.equal(r.statusCode,200,r.body);
    assert.equal((await session(studentCookie)).statusCode,401);assert.equal(await tx.loginChallenge.count({where:{userId:student.id}}),0);
   });
   await t.test('origins and logout are enforced; password endpoints are absent',async()=>{
    assert.equal((await app.inject({method:'POST',url:'/auth/otp/request',headers:{origin:'https://elsewhere.example'},payload:{email:admin.email}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/auth/student/login',headers,payload:{email:admin.email,password:'unused'}})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:'/auth/logout',headers:{...headers,cookie:adminCookie},payload:{}})).statusCode,200);assert.equal((await session(adminCookie)).statusCode,401);
   });
  }finally{await app.close()}throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect()}
});
