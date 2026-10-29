import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {PrismaClient,type Prisma} from '@prisma/client';
import {registerSubscribers} from '../src/subscribers.js';
import {loadConfig} from '../src/config.js';
const db=new PrismaClient();const rollback=new Error('rollback import fixtures');
test('bulk subscriber import against local PostgreSQL',async t=>{
 assert.ok(['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local database only');
 try{
  await db.$transaction(async tx=>{
   const key=randomUUID(),actorId=randomUUID();
   const course=await tx.academicCourse.create({data:{name:`Import ${key}`,nameKey:key,code:`C-${key}`}});
   const subject=await tx.academicSubject.create({data:{name:`Import ${key}`,nameKey:key}});
   const plan=await tx.academicPlan.create({data:{courseId:course.id,name:`Import ${key}`,nameKey:key}});
   const programme=await tx.academicProgramme.create({data:{courseId:course.id,name:`Import ${key}`,nameKey:key,locked:true,plans:{create:{planId:plan.id}},subjects:{create:{subjectId:subject.id}}}});
   const scopedDb=new Proxy(tx,{get(target,prop,receiver){if(prop==='$transaction')return async(callback:(client:Prisma.TransactionClient)=>Promise<unknown>)=>callback(tx);return Reflect.get(target,prop,receiver);}}) as unknown as PrismaClient;
   let roles:Array<'SUPER_ADMIN'|'CONTENT_MANAGER'>=['SUPER_ADMIN'];
   const app=Fastify();registerSubscribers(app,scopedDb,loadConfig(),async()=>({userId:actorId,roles}));
   const email=()=>`import-${randomUUID()}@example.com`;
   const payload=(rows:Array<Record<string,unknown>>)=>({courseId:course.id,programmeId:programme.id,subjectIds:[subject.id],planIds:[plan.id],activeFrom:'2026-10-29T00:00:00+05:30',validUntil:null,rows});
   const row=(address=email())=>({name:'Import Test Student',email:address,phone:'',course:course.name});
   const request=(url:string,body:unknown)=>app.inject({method:'POST',url:`/v1/admin/subscribers${url}`,payload:body});
   try{
    await t.test('valid bulk file creates students and mapped subscriptions; reupload changes nothing',async()=>{
     const students=[row(),row()],input=payload(students);
     let response=await request('/import/validate',input);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().valid,true);
     response=await request('/import',input);assert.equal(response.statusCode,201,response.body);assert.equal(response.json().created,2);assert.equal(response.json().grantsAdded,2);
     const users=await tx.user.findMany({where:{email:{in:students.map(student=>student.email)}},include:{enrollments:true,roles:true}});
     assert.equal(users.length,2);assert.ok(users.every(user=>user.enrollments.length===1&&user.roles.some(role=>role.role==='STUDENT')&&user.phone===null));
     const before=await tx.auditEvent.count({where:{actorId,action:'SUBSCRIBER_CSV_IMPORTED'}});
     response=await request('/import',input);assert.equal(response.statusCode,409);assert.match(response.json().message,/already exists/);
     assert.equal(await tx.auditEvent.count({where:{actorId,action:'SUBSCRIBER_CSV_IMPORTED'}}),before);
    });
    await t.test('case/whitespace duplicates within a new CSV reject the entire batch',async()=>{
     const address=email();const input=payload([row(address),row(` ${address.toUpperCase()} `)]);
     let response=await request('/import/validate',input);assert.equal(response.statusCode,200);assert.equal(response.json().valid,false);assert.equal(response.json().issues[0].row,3);
     response=await request('/import',input);assert.equal(response.statusCode,409);
     assert.equal(await tx.user.count({where:{email:address}}),0);
    });
    await t.test('existing legacy email with case/space rejects mixed batch and preserves all original data',async()=>{
     const address=email(),newAddress=email();
     const original=await tx.user.create({data:{identitySub:`pending:${randomUUID()}`,email:` ${address.toUpperCase()} `,displayName:'Original name',phone:'1234567890',revision:7,roles:{create:{role:'STUDENT'}},enrollments:{create:{courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:plan.id}}},include:{enrollments:true}});
     const input=payload([row(newAddress),{...row(address),name:'Do not overwrite',phone:'9999999999'}]);
     let response=await request('/import/validate',input);assert.equal(response.json().valid,false);assert.equal(response.json().issues[0].code,'EXISTING_EMAIL');
     response=await request('/import',input);assert.equal(response.statusCode,409);
     assert.equal(await tx.user.count({where:{email:newAddress}}),0);
     const after=await tx.user.findUniqueOrThrow({where:{id:original.id},include:{enrollments:true}});assert.deepEqual(after,original);
    });
    await t.test('reviewed remaining records can be imported without changing an existing partial profile',async()=>{
     const existingEmail=email(),newEmail=email();
     const original=await tx.user.create({data:{identitySub:`pending:${randomUUID()}`,email:existingEmail,displayName:null,roles:{create:{role:'STUDENT'}}},include:{enrollments:true}});
     const input=payload([row(existingEmail),row(newEmail)]);
     const review=await request('/import/validate',input);assert.equal(review.statusCode,200,review.body);
     const issues=review.json().issues as Array<{row:number;code:string}>;
     assert.equal(issues[0]?.code,'EXISTING_EMAIL');
     assert.equal(await tx.user.count({where:{email:newEmail}}),0,'validation must not create any students');
     const excluded=new Set(issues.map(issue=>issue.row-2));
     const remaining={...input,rows:input.rows.filter((_,index)=>!excluded.has(index))};
     const response=await request('/import',remaining);assert.equal(response.statusCode,201,response.body);assert.equal(response.json().created,1);
     assert.deepEqual(await tx.user.findUniqueOrThrow({where:{id:original.id},include:{enrollments:true}}),original);
     assert.equal(await tx.user.count({where:{email:newEmail}}),1);
    });
    await t.test('employee and disabled account emails are also duplicates',async()=>{
     for(const enabled of [true,false]){
      const address=email();await tx.user.create({data:{identitySub:`pending:${randomUUID()}`,email:address,enabled,roles:{create:{role:enabled?'CONTENT_MANAGER':'STUDENT'}}}});
      const response=await request('/import',payload([row(address)]));assert.equal(response.statusCode,409);
     }
    });
    await t.test('mixed courses, invalid rows and obsolete replacement requests are actionable and atomic',async()=>{
     let response=await request('/import/validate',payload([{...row(),course:'Another course'}]));assert.equal(response.statusCode,200);assert.deepEqual(response.json().issues,[]);
     response=await request('/import',payload([{...row(),email:'invalid'}]));assert.equal(response.statusCode,422);assert.match(response.json().message,/CSV row 2.*email/);
     response=await request('/import',{...payload([row()]),replaceExisting:true});assert.equal(response.statusCode,422);assert.match(response.json().message,/new students only/);
    });
    await t.test('manual Add student cannot overwrite an existing subscriber',async()=>{
     const address=email();const original=await tx.user.create({data:{identitySub:`pending:${randomUUID()}`,email:address,displayName:'Original',roles:{create:{role:'STUDENT'}}}});
     const response=await request('',{email:address,displayName:'Overwritten',grants:[{courseId:course.id,programmeId:programme.id,subjectId:subject.id,planId:plan.id,validUntil:null}]});
     assert.equal(response.statusCode,409);assert.equal((await tx.user.findUniqueOrThrow({where:{id:original.id}})).displayName,'Original');
    });
    await t.test('200-row supported limit succeeds and oversized input is rejected before creation',async()=>{
     const students=Array.from({length:200},()=>row());
     let response=await request('/import',payload(students));assert.equal(response.statusCode,201,response.body);assert.equal(response.json().created,200);
     response=await request('/import',payload(Array.from({length:201},()=>row())));assert.equal(response.statusCode,422);
    });
    await t.test('validation and import both require super-admin authorization',async()=>{
     roles=['CONTENT_MANAGER'];
     assert.equal((await request('/import/validate',payload([row()]))).statusCode,403);
     assert.equal((await request('/import',payload([row()]))).statusCode,403);
     roles=['SUPER_ADMIN'];
    });
   }finally{await app.close();}
   throw rollback;
  },{timeout:60000});
 }catch(error){if(error!==rollback)throw error;}
 finally{await db.$disconnect();}
});

test('database unique index rejects concurrent normalized email creation',async()=>{
 const client=new PrismaClient();const address=`race-${randomUUID()}@example.com`;
 try{
  const result=await Promise.allSettled([client.user.create({data:{identitySub:`pending:${randomUUID()}`,email:address}}),client.user.create({data:{identitySub:`pending:${randomUUID()}`,email:` ${address.toUpperCase()} `}})]);
  assert.equal(result.filter(item=>item.status==='fulfilled').length,1);
  const failed=result.find(item=>item.status==='rejected');assert.equal(failed?.status==='rejected'&&(failed.reason as {code?:string}).code,'P2002');
 }finally{
  await client.user.deleteMany({where:{OR:[{email:address},{email:` ${address.toUpperCase()} `}]}});await client.$disconnect();
 }
});
