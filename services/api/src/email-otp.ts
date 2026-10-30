import {randomInt,randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {PrismaClient,UserRole} from '@prisma/client';
import {z} from 'zod';
import {AuthError,type Principal} from './auth.js';
import type {Config} from './config.js';
import {normalizeSubscriberEmail} from './subscriber-email.js';
import {subscriberState} from './academic-lifecycle-policy.js';
import {digestSecret,freshSecret} from './session-crypto.js';
const emailSchema=z.string().trim().email().max(254).transform(normalizeSubscriberEmail);
const OTP_MS=10*60_000,SESSION_MS=12*60*60_000,IDLE_MS=30*60_000;
export type OtpDelivery=(email:string,code:string)=>Promise<void>;
function hashCode(code:string,salt:string):Promise<Buffer>{return new Promise((resolve,reject)=>scrypt(code,salt,32,{N:16384,r:8,p:1,maxmem:32*1024*1024},(err,key)=>err?reject(err):resolve(key)));}
export async function loginAccount(db:PrismaClient,id:string){
 const user=await db.user.findUniqueOrThrow({where:{id},include:{roles:true,enrollments:true,employeeProfile:true,modulePermissions:true}});
 const roles=user.roles.map(r=>r.role),studentOnly=roles.length===1&&roles[0]==='STUDENT';
 const status=studentOnly?subscriberState(user.enabled,user.enrollments,new Date()):'ACTIVE';
 const [courses,programmes,plans]=await Promise.all([
  db.academicCourse.findMany({where:{id:{in:user.enrollments.map(g=>g.courseId)}},select:{id:true,name:true}}),
  db.academicProgramme.findMany({where:{id:{in:user.enrollments.map(g=>g.programmeId)}},select:{id:true,name:true}}),
  db.academicPlan.findMany({where:{id:{in:user.enrollments.map(g=>g.planId)}},select:{id:true,name:true}}),
 ]);
 const subscriptions=[...new Map(user.enrollments.map(g=>[`${g.courseId}:${g.programmeId}:${g.planId}:${+g.activeFrom}:${g.validUntil?+g.validUntil:''}`,{
  courseId:g.courseId,programmeId:g.programmeId,planId:g.planId,courseName:courses.find(c=>c.id===g.courseId)?.name??'Course',programmeName:programmes.find(p=>p.id===g.programmeId)?.name??'Programme',planName:plans.find(p=>p.id===g.planId)?.name??'Plan',activeFrom:g.activeFrom.toISOString(),validUntil:g.validUntil?.toISOString()??null,
 }])).values()];
 return {userId:user.id,displayName:user.displayName,email:user.email,phone:user.phone,roles,status,employee:!!user.employeeProfile,employeeDetails:user.employeeProfile,modulePermissions:user.modulePermissions,featuresLocked:studentOnly&&status!=='ACTIVE',subscriptions,grants:user.enrollments};
}
export function registerEmailOtp(app:FastifyInstance,db:PrismaClient,cfg:Config,deliver?:OtpDelivery){
 const origin=new URL(cfg.CORS_ORIGIN).origin,secure=origin.startsWith('https:'),cookieName=secure?'__Host-dochub_session':'dochub_session';
 if(process.env.NODE_ENV==='production'&&!secure)throw new Error('HTTPS required for email OTP sessions');
 const ses=new SESv2Client({region:cfg.AWS_REGION});app.addHook('onClose',async()=>ses.destroy());
 const send:OtpDelivery=deliver??(async(email,code)=>{
  if(!cfg.SES_FROM_EMAIL)throw new AuthError(503,'Email delivery is not configured. Contact your administrator.');
  await ses.send(new SendEmailCommand({FromEmailAddress:cfg.SES_FROM_EMAIL,Destination:{ToAddresses:[email]},Content:{Simple:{Subject:{Data:`${code} is your DocHub sign-in code`},Body:{Text:{Data:`Your DocHub sign-in code is ${code}.\n\nThis code expires in 10 minutes and can be used once. If you did not request it, ignore this email. Do not share your code.`}}}}}));
 });
 const deviceCookieName=secure?'__Host-dochub_device':'dochub_device';
 const readDevice=(req:FastifyRequest)=>{const value=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(deviceCookieName+'='))?.slice(deviceCookieName.length+1);return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;};
 const deviceHeader=(value:string)=>`${deviceCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure?'; Secure':''}`;
 const originGuard=(req:FastifyRequest)=>{if(req.headers.origin!==origin)throw new AuthError(403,'Request origin is not allowed');if(!req.headers['content-type']?.startsWith('application/json'))throw new AuthError(415,'JSON request required');};
 const readSecret=(req:FastifyRequest)=>{const value=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;};
 const setCookie=(reply:FastifyReply,secret:string,maxAge:number)=>reply.header('Set-Cookie',`${cookieName}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`).header('Cache-Control','no-store');
 const throttle=async(key:string,max:number)=>{
  const now=new Date(),expiresAt=new Date(+now+15*60_000),name=digestSecret(`email-otp:${key}`);
  const row=await db.studentAuthThrottle.upsert({where:{key:name},create:{key:name,count:1,expiresAt},update:{count:{increment:1}}});
  if(row.expiresAt<=now){await db.studentAuthThrottle.updateMany({where:{key:name,expiresAt:{lte:now}},data:{count:1,expiresAt}});return;}
  if(row.count>max)throw new AuthError(429,'Too many attempts. Please try again later.');
 };
 const authorize=async(req:FastifyRequest,requireFeatures=true):Promise<Principal>=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)throw new AuthError(403,'Request origin is not allowed');
  const secret=readSecret(req),now=new Date();if(!secret)throw new AuthError(401,'Sign in to continue');
  // One indexed query; still recheck revocation, roles and expiry on every request.
  const [session]=await db.$queryRaw<Array<{id:string;userId:string;email:string;userEmail:string|null;displayName:string|null;enabled:boolean;roles:UserRole[];revokedAt:Date|null;expiresAt:Date;lastSeenAt:Date;active:boolean}>>`
   SELECT s.id,s."userId",s.email,s."revokedAt",s."expiresAt",s."lastSeenAt",u.email "userEmail",u."displayName",u.enabled,
    ARRAY(SELECT r.role::text FROM "UserProfile" r WHERE r."userId"=u.id) roles,
    (${!requireFeatures} OR EXISTS(SELECT 1 FROM "Enrollment" e WHERE e."userId"=u.id AND e."activeFrom"<=${now} AND (e."validUntil" IS NULL OR e."validUntil">${now}))) active
   FROM "AppSession" s JOIN "User" u ON u.id=s."userId" WHERE s."tokenHash"=${digestSecret(secret)}`;
  if(!session||session.revokedAt||session.expiresAt<=now||+session.lastSeenAt+IDLE_MS<=+now||normalizeSubscriberEmail(session.userEmail??'')!==session.email)throw new AuthError(401,'Your session has expired. Sign in again.');
  const roles=session.roles,studentOnly=roles.length===1&&roles[0]==='STUDENT';
  if(!roles.length||(!studentOnly&&!session.enabled))throw new AuthError(403,'Account unavailable');
  if(studentOnly&&requireFeatures&&(!session.enabled||!session.active))throw new AuthError(403,'Learning features are locked. Your profile remains available.');
  if(+session.lastSeenAt<+now-5*60_000)await db.appSession.updateMany({where:{id:session.id,revokedAt:null},data:{lastSeenAt:now}});
  return {userId:session.userId,roles,displayName:session.displayName};
 };
 app.post('/auth/otp/request',async(req,reply)=>{
  originGuard(req);const {email}=z.object({email:emailSchema}).strict().parse(req.body);
  await throttle(`request:ip:${req.ip}`,30);await throttle(`request:email:${email}`,5);
  if(!deliver&&!cfg.SES_FROM_EMAIL)throw new AuthError(503,'Email delivery is not configured. Contact your administrator.');
  const matches=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM "User" WHERE lower(btrim(email)) = ${email} LIMIT 2`;
  const candidates=await db.user.findMany({where:{id:{in:matches.map(user=>user.id)}},include:{roles:true}});
  const candidate=candidates.length===1?candidates[0]:undefined;
  const user=candidate?.roles.length&&(candidate.enabled||candidate.roles.every(r=>r.role==='STUDENT'))?candidate:undefined;
  const id=randomUUID(),code=String(randomInt(0,1_000_000)).padStart(6,'0'),salt=randomBytes(24).toString('hex'),now=new Date();
  const codeHash=(await hashCode(code,salt)).toString('hex');
  await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 1))::text`;
   await tx.loginChallenge.deleteMany({where:{email}});
   await tx.loginChallenge.create({data:{id,email,userId:user?.id??null,salt,codeHash,expiresAt:new Date(+now+OTP_MS)}});
  });
  if(user)try{await send(email,code)}catch{
   await db.loginChallenge.update({where:{id},data:{consumedAt:new Date()}});throw new AuthError(503,'Unable to deliver the sign-in email. Please try again.');
  }
  if(!readDevice(req))reply.header('Set-Cookie',deviceHeader(freshSecret()));
  reply.header('Cache-Control','no-store');
  return {challengeId:id,expiresInSeconds:OTP_MS/1000,resendAfterSeconds:60,message:'If this email is registered, a sign-in code has been sent.'};
 });
 app.post('/auth/otp/verify',async(req,reply)=>{
  originGuard(req);const input=z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
  await throttle(`verify:ip:${req.ip}`,60);
  const challenge=await db.loginChallenge.findUnique({where:{id:input.challengeId}});
  const derived=await hashCode(input.code,challenge?.salt??'invalid-challenge');
  const matches=!!challenge&&timingSafeEqual(derived,Buffer.from(challenge.codeHash,'hex'));
  const secret=freshSecret(),device=readDevice(req)??freshSecret(),now=new Date();
  const userId=await db.$transaction(async tx=>{
   const claimed=await tx.loginChallenge.updateMany({where:{id:input.challengeId,consumedAt:null,attempts:{lt:5},expiresAt:{gt:now}},data:{attempts:{increment:1}}});
   if(!claimed.count||!matches||!challenge?.userId)return null;
   const user=await tx.user.findUnique({where:{id:challenge.userId},include:{roles:true}});
   if(!user||normalizeSubscriberEmail(user.email??'')!==challenge.email||!user.roles.length||(!user.enabled&&user.roles.some(r=>r.role!=='STUDENT')))return null;
   // Serialize device admission per user so concurrent logins cannot exceed two.
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
   const activeWhere={userId:user.id,revokedAt:null,expiresAt:{gt:now},lastSeenAt:{gt:new Date(+now-IDLE_MS)}};
   const current=readSecret(req);
   const existing=await tx.appSession.findFirst({where:{...activeWhere,OR:[{deviceHash:digestSecret(device)},...(current?[{tokenHash:digestSecret(current)}]:[])]}});
   if(!existing&&await tx.appSession.count({where:activeWhere})>=2)return 'DEVICE_LIMIT';
   await tx.loginChallenge.delete({where:{id:input.challengeId}});
   const sessionData={email:challenge.email,deviceHash:digestSecret(device),tokenHash:digestSecret(secret),lastSeenAt:now,expiresAt:new Date(+now+SESSION_MS)};
   if(existing)await tx.appSession.update({where:{id:existing.id},data:sessionData});
   else await tx.appSession.create({data:{userId:user.id,...sessionData}});
   await tx.auditEvent.create({data:{actorId:user.id,targetId:user.id,action:'EMAIL_OTP_LOGIN',details:{method:'email-otp'}}});return user.id;
  });
  if(userId==='DEVICE_LIMIT')throw new AuthError(409,'Two devices are already signed in. Sign out on one of them before signing in on a third device.');
  if(!userId)throw new AuthError(401,'Invalid or expired code. Request a new code and try again.');
  setCookie(reply,secret,SESSION_MS/1000);reply.header('Set-Cookie',[String(reply.getHeader('Set-Cookie')),deviceHeader(device)]);return loginAccount(db,userId);
 });
 app.get('/auth/session',async(req,reply)=>{const p=await authorize(req,false);reply.header('Cache-Control','no-store');return loginAccount(db,p.userId)});
 app.post('/auth/logout',async(req,reply)=>{
  originGuard(req);const secret=readSecret(req);if(secret)await db.appSession.updateMany({where:{tokenHash:digestSecret(secret),revokedAt:null},data:{revokedAt:new Date()}});
  setCookie(reply,'',0);return {status:'signed_out'};
 });
 return authorize;
}
