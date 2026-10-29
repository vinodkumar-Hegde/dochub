/** Password-based student sign-in, independent of Cognito. No public registration.
 * Server-side session tokens are random, hashed at rest, and stored only in
 * HttpOnly SameSite cookies. Admin/employee bearer auth remains unchanged. */
import { randomUUID, scryptSync } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { AuthError, type Principal } from './auth.js';
import { normalizeSubscriberEmail } from './subscriber-email.js';
import {
  digestSecret,freshSecret,hashStudentPassword,verifyStudentPassword,
  studentPasswordValid,studentSessionCurrent,studentCookieName,studentSetCookie,
  STUDENT_SESSION_MS,STUDENT_LINK_MS,
} from './student-auth-policy.js';

const email=z.string().trim().email().max(254).transform(normalizeSubscriberEmail);
const emailBody=z.object({email}).strict();
const loginBody=z.object({email,password:z.string().min(1).max(256)}).strict();
const finishBody=z.object({token:z.string().min(30).max(180),password:z.string().min(12).max(128)}).strict();
const USER_MESSAGE='If this email belongs to an eligible student, a secure link will be sent.';
// One fixed dummy credential hash forces a similar scrypt cost for unknown emails.
const DUMMY_HASH='scrypt$1$'+Buffer.alloc(24,7).toString('base64url')+'$'+
  scryptSync('unused dummy account',Buffer.alloc(24,7),64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('base64url');

function extractCookie(request:FastifyRequest,name:string):string|null {
  const raw=request.headers.cookie;
  if(!raw)return null;
  for(const segment of raw.split(';')) {
    const item=segment.trim();
    if(item.startsWith(name+'=')) {
      const token=item.slice(name.length+1);
      return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
    }
  }
  return null;
}

async function rateLimit(db:PrismaClient,key:string,maximum:number,ms:number):Promise<void> {
  // Shared Postgres counter works with concurrent/load-balanced API instances.
  const now=new Date(),until=new Date(now.getTime()+ms);
  const row=await db.studentAuthThrottle.upsert({
    where:{key},create:{key,count:1,expiresAt:until},update:{count:{increment:1}},
  });
  if(row.expiresAt<=now){
    await db.studentAuthThrottle.updateMany({where:{key,expiresAt:{lte:now}},data:{count:1,expiresAt:until}});
    return;
  }
  if(row.count>maximum)throw new AuthError(429,'Too many attempts; try again later');
}

export function registerStudentAuthentication(app:FastifyInstance,db:PrismaClient,cfg:Config):
  (request:FastifyRequest)=>Promise<Principal> {
  const publicOrigin=new URL(cfg.STUDENT_APP_ORIGIN??cfg.CORS_ORIGIN).origin;
  if(publicOrigin!==new URL(cfg.CORS_ORIGIN).origin)throw new Error('Student origin must match CORS_ORIGIN');
  const secure=publicOrigin.startsWith('https:');
  if(process.env.NODE_ENV==='production'&&!secure)throw new Error('HTTPS required for production student authentication');
  const cookieName=studentCookieName(secure);
  const ses=new SESv2Client({region:cfg.AWS_REGION});
  app.addHook('onClose',async()=>ses.destroy());
  const originGuard=(req:FastifyRequest)=>{
    // Browser Origin is compulsory on password/session mutation endpoints.
    if(req.headers.origin!==publicOrigin)throw new AuthError(403,'Request origin is not allowed');
    if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw new AuthError(415,'JSON request required');
  };
  const sessionAccount=(user:{id:string;displayName:string|null})=>({userId:user.id,displayName:user.displayName,roles:['STUDENT'] as const});
  const cookie=(reply:FastifyReply,secret:string,maxAge:number)=>{
    reply.header('Set-Cookie',studentSetCookie(secret,secure,maxAge)).header('Cache-Control','no-store');
  };
  const authorize=async(req:FastifyRequest):Promise<Principal>=>{
    const secret=extractCookie(req,cookieName);
    if(!secret)throw new AuthError(401,'Student sign-in required');
    const tokenHash=digestSecret(secret),now=new Date();
    const session=await db.studentSession.findUnique({where:{tokenHash},include:{user:{include:{roles:true,studentCredential:true}}}});
    if(!session||!studentSessionCurrent(session,now)||!session.user.enabled||
      !session.user.roles.some(role=>role.role==='STUDENT')||session.user.roles.some(role=>role.role!=='STUDENT')||
      !session.user.studentCredential||session.credentialRevision!==session.user.studentCredential.revision){
      throw new AuthError(401,'Student session expired');
    }
    // Automatic expiry / activation enforcement on EVERY protected request.
    const active=await db.enrollment.findFirst({where:{userId:session.userId,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]},select:{userId:true}});
    if(!active)throw new AuthError(403,'Your subscription is not currently active');
    if(session.lastSeenAt.getTime()<now.getTime()-5*60*1000){
      await db.studentSession.updateMany({where:{id:session.id,revokedAt:null},data:{lastSeenAt:now}});
    }
    return {userId:session.userId,roles:['STUDENT'],displayName:session.user.displayName};
  };
  const throttle=async(req:FastifyRequest,action:string,submittedEmail?:string)=>{
    await rateLimit(db,digestSecret(`student:${action}:ip:${req.ip}`),2000,15*60_000);
    if(submittedEmail)await rateLimit(db,digestSecret(`student:${action}:email:${submittedEmail}`),
      action.endsWith('-request')?3:10,action.endsWith('-request')?60*60_000:15*60_000);
  };

  app.get('/auth/student/me',async(req,reply)=>{
    reply.header('Cache-Control','no-store');
    const principal=await authorize(req);
    return {userId:principal.userId,displayName:principal.displayName,roles:['STUDENT']};
  });

  app.post('/auth/student/login',async(req,reply)=>{
    originGuard(req);
    const input=loginBody.parse(req.body);
    await throttle(req,'login',input.email);
    const users=await db.user.findMany({where:{email:{equals:input.email,mode:'insensitive'},enabled:true,roles:{some:{role:'STUDENT'}}},include:{roles:true,studentCredential:true},take:2});
    const user=users.length===1&&users[0]!.roles.every(r=>r.role==='STUDENT')?users[0]:null;
    // Always perform comparable expensive verification for missing accounts.
    const valid=await verifyStudentPassword(input.password,user?.studentCredential?.passwordHash??DUMMY_HASH);
    if(!valid||!user){
      req.log.warn({event:'STUDENT_LOGIN_REJECTED'},'Invalid student credentials');
      throw new AuthError(401,'Invalid email or password');
    }
    const now=new Date();
    const active=await db.enrollment.findFirst({where:{userId:user.id,activeFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]},select:{userId:true}});
    if(!active)throw new AuthError(403,'Your subscription is not currently active');
    const secret=freshSecret();
    await db.$transaction(async tx=>{
      await tx.studentSession.create({data:{userId:user.id,credentialRevision:user.studentCredential!.revision,tokenHash:digestSecret(secret),expiresAt:new Date(now.getTime()+STUDENT_SESSION_MS)}});
      await tx.auditEvent.create({data:{actorId:user.id,targetId:user.id,action:'STUDENT_LOGIN',details:{method:'password'}}});
    });
    cookie(reply,secret,Math.floor(STUDENT_SESSION_MS/1000));
    return sessionAccount(user);
  });

  app.post('/auth/student/logout',async(req,reply)=>{
    originGuard(req);
    const secret=extractCookie(req,cookieName);
    if(secret){
      const session=await db.studentSession.findUnique({where:{tokenHash:digestSecret(secret)}});
      if(session){
        await db.$transaction(async tx=>{
          await tx.studentSession.updateMany({where:{id:session.id,revokedAt:null},data:{revokedAt:new Date()}});
          await tx.auditEvent.create({data:{actorId:session.userId,targetId:session.userId,action:'STUDENT_LOGOUT',details:{sessionId:session.id}}});
        });
      }
    }
    cookie(reply,'',0);
    return {status:'signed_out'};
  });

  for(const purpose of ['activate','reset'] as const){
    app.post(`/auth/student/${purpose}/request`,async(req)=>{
      originGuard(req);
      const input=emailBody.parse(req.body);
      await throttle(req,`${purpose}-request`,input.email);
      if(!cfg.SES_FROM_EMAIL)throw new AuthError(503,'Student activation email delivery is not configured');
      const users=await db.user.findMany({where:{email:{equals:input.email,mode:'insensitive'},enabled:true,roles:{some:{role:'STUDENT'}}},include:{roles:true,studentCredential:true,enrollments:{select:{userId:true},take:1}},take:2});
      const user=users.length===1?users[0]:null;
      if(!user||user.roles.some(r=>r.role!=='STUDENT')||user.enrollments.length===0||
        (purpose==='activate'&&user.studentCredential)||(purpose==='reset'&&!user.studentCredential))return {message:USER_MESSAGE};
      const secret=freshSecret(),id=randomUUID(),now=new Date();
      const token=`${id}.${secret}`;
      await db.$transaction(async tx=>{
        await tx.studentAuthToken.updateMany({where:{userId:user.id,purpose,usedAt:null},data:{usedAt:now}});
        await tx.studentAuthToken.create({data:{id,userId:user.id,tokenHash:digestSecret(secret),purpose,expiresAt:new Date(now.getTime()+STUDENT_LINK_MS)}});
      });
      const fragment=new URLSearchParams({'student-action':purpose,token});
      const link=`${publicOrigin}/#${fragment.toString()}`;
      try{
        await ses.send(new SendEmailCommand({
          FromEmailAddress:cfg.SES_FROM_EMAIL,
          Destination:{ToAddresses:[input.email]},
          Content:{Simple:{Subject:{Data:purpose==='activate'?'Activate your DocHub student account':'Reset your DocHub password'},
            Body:{Text:{Data:`Open this one-time link to ${purpose==='activate'?'activate your account':'reset your password'}:\n\n${link}\n\nIt expires in 30 minutes. If you did not request this, ignore this message.`}}}},
        }));
      }catch(error){
        await db.studentAuthToken.deleteMany({where:{id}});
        req.log.error({errorName:error instanceof Error?error.name:'unknown'},'Student email delivery failed');
        throw new AuthError(503,'Student email delivery is temporarily unavailable');
      }
      await db.auditEvent.create({data:{actorId:null,targetId:user.id,action:'STUDENT_AUTH_LINK_SENT',details:{purpose,requestedBy:'unverified_email_request'}}});
      return {message:USER_MESSAGE};
    });

    app.post(`/auth/student/${purpose}/complete`,async req=>{
      originGuard(req);
      await throttle(req,`${purpose}-complete`);
      const input=finishBody.parse(req.body);
      if(!studentPasswordValid(input.password))throw new AuthError(422,'Use a unique password of 12–128 characters');
      const [id,secret,...extra]=input.token.split('.');
      if(!id||!secret||extra.length||!z.string().uuid().safeParse(id).success||!/^[A-Za-z0-9_-]{43}$/.test(secret))
        throw new AuthError(400,'Invalid or expired link');
      const passwordHash=await hashStudentPassword(input.password);
      const now=new Date();
      await db.$transaction(async tx=>{
        const used=await tx.studentAuthToken.updateMany({where:{id,tokenHash:digestSecret(secret),purpose,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
        if(used.count!==1)throw new AuthError(400,'Invalid or expired link');
        const oneTime=await tx.studentAuthToken.findUniqueOrThrow({where:{id},include:{user:{include:{roles:true,studentCredential:true}}}});
        if(!oneTime.user.enabled||!oneTime.user.roles.some(r=>r.role==='STUDENT')||oneTime.user.roles.some(r=>r.role!=='STUDENT'))
          throw new AuthError(403,'Account unavailable');
        const existing=await tx.studentCredential.findUnique({where:{userId:oneTime.userId}});
        if(purpose==='activate'&&existing)throw new AuthError(409,'Account is already activated');
        if(purpose==='reset'&&!existing)throw new AuthError(409,'Account activation required');
        await tx.studentCredential.upsert({where:{userId:oneTime.userId},create:{userId:oneTime.userId,passwordHash,revision:1},update:{passwordHash,passwordUpdatedAt:now,revision:{increment:1}}});
        await tx.studentSession.updateMany({where:{userId:oneTime.userId,revokedAt:null},data:{revokedAt:now}});
        await tx.studentAuthToken.updateMany({where:{userId:oneTime.userId,usedAt:null},data:{usedAt:now}});
        await tx.auditEvent.create({data:{actorId:oneTime.userId,targetId:oneTime.userId,action:purpose==='activate'?'STUDENT_ACTIVATED':'STUDENT_PASSWORD_RESET',details:{method:'email-link'}}});
      });
      return {status:'password_saved'};
    });
  }
  return authorize;
}
