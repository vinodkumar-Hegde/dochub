export type Account = { userId: string; displayName?: string|null; email?:string|null; employee?:boolean;employeeDetails?:{employeeCode:string;department:string;designation:string}|null; modulePermissions?:Array<{module:string;canView:boolean;canManage:boolean}>; phone?:string|null; featuresLocked?:boolean; status?:'ACTIVE'|'LOCKED'|'SCHEDULED'|'EXPIRED'; subscriptions?:Array<{courseId:string;programmeId:string;planId:string;courseName:string;programmeName:string;planName:string;activeFrom:string;validUntil:string|null}>; grants?:Array<{activeFrom:string;validUntil:string|null}>; roles: Array<'SUPER_ADMIN'|'CONTENT_MANAGER'|'FACULTY'|'STUDENT'> };
const apiOrigin=import.meta.env.VITE_API_ORIGIN;
let cookieSession=false;
class ApiError extends Error{constructor(message:string,public status:number){super(message)}}
async function request(path:string,options:RequestInit={},blob=false):Promise<any>{
 if(!apiOrigin)throw new Error('DocHub API is not configured');
 let response:Response;
 try{response=await fetch(`${apiOrigin}${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},credentials:'include',cache:'no-store'})}
 catch{throw new Error('Unable to reach DocHub. Check your connection.')}
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(body.message||'Unable to complete this request',response.status)}
 return blob?response:response.json();
}
export function logout(){cookieSession=false}
export async function authorizedRequest<T>(path:string,options:RequestInit={}):Promise<T>{if(!cookieSession)throw new Error('Sign in to continue');return request(path,options)}
export async function authorizedFileRequest(path:string):Promise<Blob>{if(!cookieSession)throw new Error('Sign in to continue');const response=await request(path,{},true) as Response;return response.blob()}
export async function authorizedBlobRequest(path:string):Promise<Blob>{const blob=await authorizedFileRequest(path);if(!blob.type.startsWith('image/jpeg'))throw new Error('Unexpected preview format');return blob}
export async function authorizedPdfRequest(path:string):Promise<Blob>{const blob=await authorizedFileRequest(path);if(!blob.type.startsWith('application/pdf'))throw new Error('Unexpected PDF format');return blob}
export async function emailOtpSession():Promise<Account|null>{try{const account=await request('/auth/session') as Account;cookieSession=true;return account}catch(error){if(error instanceof ApiError&&[401,403].includes(error.status)){cookieSession=false;return null}throw error}}
export const requestEmailOtp=(email:string)=>request('/auth/otp/request',{method:'POST',body:JSON.stringify({email})}) as Promise<{challengeId:string;expiresInSeconds:number;resendAfterSeconds:number;message:string}>;
export async function verifyEmailOtp(challengeId:string,code:string):Promise<Account>{const account=await request('/auth/otp/verify',{method:'POST',body:JSON.stringify({challengeId,code})}) as Account;cookieSession=true;return account}
export const emailOtpLogout=()=>request('/auth/logout',{method:'POST',body:'{}'});
