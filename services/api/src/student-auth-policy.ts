import { createHash, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
const COST=32768, BLOCK=8, PARALLEL=1;
// Node's promisify overload for scrypt exposes only three parameters in some
// @types/node versions. Wrap the callback directly to retain typed cost options.
function deriveStudentKey(password:string,salt:Buffer,length:number):Promise<Buffer> {
  return new Promise<Buffer>((resolve,reject)=>{
    callbackScrypt(password,salt,length,
      {N:COST,r:BLOCK,p:PARALLEL,maxmem:64*1024*1024},
      (error,key)=>error?reject(error):resolve(key));
  });
}
export const STUDENT_SESSION_MS=12*60*60*1000;
export const STUDENT_IDLE_MS=30*60*1000;
export const STUDENT_LINK_MS=30*60*1000;
export function studentPasswordValid(password:string):boolean {
  return password.length>=12 && password.length<=128 && !/^(.)\1+$/.test(password) &&
    !['password123456','123456789012','qwerty123456','passwordpassword'].includes(password.toLowerCase());
}
export function digestSecret(value:string):string{return createHash('sha256').update(value).digest('hex');}
export function freshSecret():string{return randomBytes(32).toString('base64url');}
export async function hashStudentPassword(password:string):Promise<string> {
  if(!studentPasswordValid(password)) throw new Error('Password must be 12–128 characters and not a commonly used password');
  const salt=randomBytes(24);
  const hash=await deriveStudentKey(password,salt,64);
  return ['scrypt','1',salt.toString('base64url'),hash.toString('base64url')].join('$');
}
export async function verifyStudentPassword(password:string,encoded:string):Promise<boolean> {
  const parts=encoded.split('$');
  if(parts.length!==4||parts[0]!=='scrypt'||parts[1]!=='1'||password.length>128)return false;
  try {
    const salt=Buffer.from(parts[2]!,'base64url'),expected=Buffer.from(parts[3]!,'base64url');
    if(salt.length!==24||expected.length!==64)return false;
    const actual=await deriveStudentKey(password,salt,expected.length);
    return timingSafeEqual(actual,expected);
  } catch{return false;}
}
export function studentSessionCurrent(session:{expiresAt:Date;lastSeenAt:Date;revokedAt:Date|null},now=new Date()):boolean {
  return session.revokedAt===null&&session.expiresAt>now&&session.lastSeenAt.getTime()+STUDENT_IDLE_MS>now.getTime();
}
export function studentActiveGrant(grants:ReadonlyArray<{activeFrom:Date;validUntil:Date|null}>,now=new Date()):boolean {
  return grants.some(g=>g.activeFrom<=now&&(g.validUntil===null||g.validUntil>now));
}
export function studentCookieName(secure:boolean):string{return secure?'__Host-dochub_student':'dochub_student_dev';}
export function studentSetCookie(secret:string,secure:boolean,maxAge:number):string {
  return `${studentCookieName(secure)}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
