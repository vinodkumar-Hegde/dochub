import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {PrismaClient,type Prisma} from '@prisma/client';
import {S3Client} from '@aws-sdk/client-s3';
import {registerNotifications} from '../src/notifications.js';
import {registerSubscribers} from '../src/subscribers.js';
import {registerEmailOtp} from '../src/email-otp.js';
import {registerSessions} from '../src/sessions.js';
import {registerDocuments} from '../src/documents.js';
import {loadConfig} from '../src/config.js';
const db=new PrismaClient();const rollback=new Error('rollback fixtures');
test('profile editing, feature locking, expiry and deletion against local PostgreSQL',async t=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local database only');
 const cfg=loadConfig();let otp='';
 try{await db.$transaction(async tx=>{
  const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
  const actorId=randomUUID(),address=`profile-${randomUUID()}@example.com`;
  const user=await tx.user.create({data:{identitySub:`pending:${randomUUID()}`,email:address,displayName:'Original Student',roles:{create:{role:'STUDENT'}},enrollments:{create:{courseId:randomUUID(),programmeId:randomUUID(),subjectId:randomUUID(),planId:randomUUID(),activeFrom:new Date(Date.now()-86400000),validUntil:new Date(Date.now()-1000)}}}});
  const app=Fastify(),s3=new S3Client({region:cfg.AWS_REGION});
  const authorize=registerEmailOtp(app,scopedDb,cfg,async(_email,code)=>{otp=code});
  let admin=true;
  registerSubscribers(app,scopedDb,cfg,async()=>({userId:actorId,roles:admin?['SUPER_ADMIN']:['CONTENT_MANAGER']}));
  registerNotifications(app,scopedDb,authorize);registerSessions(app,scopedDb,authorize);registerDocuments(app,scopedDb,s3,cfg,authorize);
  const profileUrl=`/v1/admin/subscribers/${user.id}`;
  let cookie='',revision=0;
  const patch=(payload:Record<string,unknown>)=>app.inject({method:'PATCH',url:profileUrl,payload:{revision,...payload}});
  const login=async(email=address)=>{
   const challenge=await app.inject({method:'POST',url:'/auth/otp/request',headers:{origin:cfg.CORS_ORIGIN},payload:{email}});
   const response=await app.inject({method:'POST',url:'/auth/otp/verify',headers:{origin:cfg.CORS_ORIGIN},payload:{challengeId:challenge.json().challengeId,code:otp}});
   assert.equal(response.statusCode,200,response.body);cookie=String(response.headers['set-cookie']).split(';')[0]!;return response;
  };
  const me=()=>app.inject({method:'GET',url:'/auth/session',headers:{cookie}});
  const featurePaths=['/v1/student/catalogue','/v1/student/materials','/v1/student/sessions','/v1/student/notifications','/v1/student/notifications/unread'];
  try{
   await t.test('expired student can sign in and view profile but features are locked',async()=>{
    const response=await login();assert.equal(response.json().status,'EXPIRED');assert.equal(response.json().featuresLocked,true);
    assert.equal((await me()).statusCode,200);
    for(const url of featurePaths)assert.equal((await app.inject({url,headers:{cookie}})).statusCode,403,url);
    assert.equal((await tx.user.findUniqueOrThrow({where:{id:user.id}})).enabled,true);
   });
   await t.test('renewing grants immediately restores access for the same session',async()=>{
    await tx.enrollment.updateMany({where:{userId:user.id},data:{validUntil:new Date(Date.now()+86400000)}});
    assert.equal((await me()).json().featuresLocked,false);
    for(const url of featurePaths)assert.equal((await app.inject({url,headers:{cookie}})).statusCode,200,url);
   });
   await t.test('expiry during a signed-in session locks features immediately without disabling the profile',async()=>{
    await tx.enrollment.updateMany({where:{userId:user.id},data:{validUntil:new Date(Date.now()-1)}});
    assert.equal((await me()).statusCode,200);assert.equal((await me()).json().status,'EXPIRED');
    for(const url of featurePaths)assert.equal((await app.inject({url,headers:{cookie}})).statusCode,403,url);
    assert.equal((await tx.user.findUniqueOrThrow({where:{id:user.id}})).enabled,true);
    await tx.enrollment.updateMany({where:{userId:user.id},data:{validUntil:new Date(Date.now()+86400000)}});
   });
   await t.test('name and optional phone edits preserve subscriptions; stale writes fail',async()=>{
    const before=await tx.enrollment.findMany({where:{userId:user.id}});
    let response=await patch({displayName:'Updated Student',phone:'+44 (7700) 900123'});assert.equal(response.statusCode,200,response.body);revision++;
    assert.equal((await me()).json().displayName,'Updated Student');
    assert.deepEqual(await tx.enrollment.findMany({where:{userId:user.id}}),before);
    response=await app.inject({method:'PATCH',url:profileUrl,payload:{revision:0,displayName:'Stale'}});assert.equal(response.statusCode,409);
   });
   await t.test('manual lock preserves sign-in and profile; unlock restores features',async()=>{
    let response=await patch({featuresLocked:true});assert.equal(response.statusCode,200,response.body);revision++;
    assert.equal((await me()).json().status,'LOCKED');
    for(const url of featurePaths)assert.equal((await app.inject({url,headers:{cookie}})).statusCode,403,url);
    assert.equal((await login()).json().featuresLocked,true);
    response=await patch({featuresLocked:false});assert.equal(response.statusCode,200);revision++;
    assert.equal((await me()).json().featuresLocked,false);
   });
   await t.test('email edits normalize email and invalidate old sessions and unused links',async()=>{
    await tx.studentAuthToken.create({data:{userId:user.id,tokenHash:randomUUID(),purpose:'reset',expiresAt:new Date(Date.now()+60000)}});
    const newEmail=`changed-${randomUUID()}@example.com`;
    const response=await patch({email:` ${newEmail.toUpperCase()} `});assert.equal(response.statusCode,200,response.body);revision++;
    assert.equal((await me()).statusCode,401);
    assert.equal(await tx.studentAuthToken.count({where:{userId:user.id}}),0);
    assert.equal((await login(newEmail)).json().email,newEmail);
   });
   await t.test('authorization and mixed-role protection apply to edits and deletion',async()=>{
    admin=false;assert.equal((await patch({displayName:'Forbidden'})).statusCode,403);
    assert.equal((await app.inject({method:'DELETE',url:profileUrl,payload:{revision}})).statusCode,403);admin=true;
    const employee=await tx.user.create({data:{identitySub:randomUUID(),roles:{create:[{role:'STUDENT'},{role:'SUPER_ADMIN'}]}}});
    const url=`/v1/admin/subscribers/${employee.id}`;
    assert.equal((await app.inject({method:'PATCH',url,payload:{revision:0,featuresLocked:true}})).statusCode,403);
    assert.equal((await app.inject({method:'DELETE',url,payload:{revision:0}})).statusCode,403);
   });
   await t.test('duplicate email is rejected without changing the profile',async()=>{
    const duplicate=`taken-${randomUUID()}@example.com`;
    await tx.user.create({data:{identitySub:randomUUID(),email:duplicate}});
    assert.equal((await patch({email:duplicate})).statusCode,409);
    assert.equal((await tx.user.findUniqueOrThrow({where:{id:user.id}})).revision,revision);
   });
   await t.test('delete checks revision, removes dependent data and retains audit history',async()=>{
    assert.equal((await app.inject({method:'DELETE',url:profileUrl,payload:{revision:revision-1}})).statusCode,409);
    const response=await app.inject({method:'DELETE',url:profileUrl,payload:{revision}});assert.equal(response.statusCode,200,response.body);
    assert.equal(await tx.user.findUnique({where:{id:user.id}}),null);
    assert.equal(await tx.enrollment.count({where:{userId:user.id}}),0);
    assert.equal(await tx.studentSession.count({where:{userId:user.id}}),0);
    assert.equal(await tx.studentCredential.count({where:{userId:user.id}}),0);
    assert.equal((await me()).statusCode,401);
    assert.equal(await tx.auditEvent.count({where:{targetId:user.id,action:'SUBSCRIBER_DELETED'}}),1);
   });
  }finally{await app.close();s3.destroy();}
  throw rollback;
 },{timeout:60000});}catch(error){if(error!==rollback)throw error;}finally{await db.$disconnect();}
});
