/** Cognito Hosted UI, Authorization Code + PKCE. Access tokens are held in memory only. */
export type Account = { userId: string; displayName?: string|null; roles: Array<'SUPER_ADMIN'|'CONTENT_MANAGER'|'FACULTY'|'STUDENT'> };
const issuerDomain = import.meta.env.VITE_COGNITO_DOMAIN?.replace(/\/$/, '');
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
const apiOrigin = import.meta.env.VITE_API_ORIGIN;
const redirectUri = `${location.origin}${location.pathname}`;
const verifierKey = 'dochub:pkce:verifier';
const stateKey = 'dochub:pkce:state';
let token: string | null = null;
let expiry = 0;
let studentCookieSession = false;
export const configured = Boolean(issuerDomain && clientId && apiOrigin);
function base64Url(buffer: Uint8Array): string {
  let binary = '';for(const char of buffer) binary += String.fromCharCode(char);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function randomValue():string {return base64Url(crypto.getRandomValues(new Uint8Array(32)));}
export async function startLogin():Promise<void> {
  if (!issuerDomain || !clientId || !apiOrigin) throw new Error('Authentication configuration is missing');
  const verifier = randomValue();const state = randomValue();
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(verifierKey,verifier);sessionStorage.setItem(stateKey,state);
  const params = new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri,scope:'openid email profile',code_challenge:challenge,code_challenge_method:'S256',state});
  location.assign(`${issuerDomain}/oauth2/authorize?${params}`);
}
export async function consumeLogin():Promise<boolean> {
  const url = new URL(location.href); const code=url.searchParams.get('code');
  if(!code) {if(url.searchParams.has('error')) throw new Error('Sign-in was cancelled or denied');return false;}
  const state=sessionStorage.getItem(stateKey);const verifier=sessionStorage.getItem(verifierKey);
  sessionStorage.removeItem(stateKey);sessionStorage.removeItem(verifierKey);
  history.replaceState(null,'',redirectUri);
  if(!state||url.searchParams.get('state')!==state||!verifier)throw new Error('Invalid login state; please sign in again');
  if (!issuerDomain || !clientId || !apiOrigin) throw new Error('Authentication configuration is missing');
  const res=await fetch(`${issuerDomain}/oauth2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:redirectUri,code_verifier:verifier})});
  if(!res.ok)throw new Error('Identity provider token exchange failed');
  const json=await res.json() as {access_token?:string;expires_in?:number};
  if(!json.access_token||!json.expires_in)throw new Error('Incomplete identity provider response');
  token=json.access_token;expiry=Date.now()+json.expires_in*1000;
  return true;
}
export async function getAccount():Promise<Account> {
  if(!token||Date.now()>=expiry-30_000)throw new Error('Session expired; sign in again');
  const res=await fetch(`${apiOrigin}/auth/me`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!res.ok)throw new Error(res.status===403?'Your account is not authorized':'Unable to verify your login');
  return await res.json() as Account;
}
export function logout():void {token=null;expiry=0;studentCookieSession=false;sessionStorage.removeItem(verifierKey);sessionStorage.removeItem(stateKey);}

/** All authenticated module APIs use the short-lived token kept in memory. */
export async function authorizedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!apiOrigin || (!studentCookieSession && (!token || Date.now() >= expiry - 30_000))) {
    throw new Error('Session expired. Sign in again.');
  }
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${path}`, {
      ...options,
      headers: { ...(options.body == null ? {} : { 'Content-Type': 'application/json' }), ...options.headers, ...(!studentCookieSession ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: studentCookieSession ? 'include' : 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new Error('DocHub API is unavailable. Check your local backend connection.');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const serverMessage = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message : 'Unable to save changes';
    throw new Error(response.status === 401 ? 'Session expired. Sign in again.' : serverMessage);
  }
  return await response.json() as T;
}

/** Fetch a single protected preview image with the in-memory Cognito token.
 * Never expose the token or an S3 object URL in the browser's address bar.
 */
export async function authorizedBlobRequest(path: string): Promise<Blob> {
  if (!apiOrigin || (!studentCookieSession && (!token || Date.now() >= expiry - 30_000))) throw new Error('Session expired. Sign in again.');
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${path}`, {
      headers: studentCookieSession ? {} : { Authorization: `Bearer ${token}` }, credentials: studentCookieSession ? 'include' : 'omit', cache: 'no-store',
    });
  } catch { throw new Error('DocHub API is unavailable.'); }
  if (!response.ok) {
    const body:unknown=await response.json().catch(()=>({}));
    const reason=body&&typeof body==='object'&&'message' in body&&typeof body.message==='string' ? body.message : '';
    if(response.status===401)throw new Error('Session expired. Sign in again.');
    if(response.status===403||response.status===404)throw new Error('This material is no longer accessible under your active subscription. Refresh My learning.');
    if(response.status===409||response.status===503)throw new Error(reason||'Secure PDF pages are not available. Ask an administrator to prepare the published preview.');
    throw new Error(`Secure preview unavailable (HTTP ${response.status})`);
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('image/jpeg')) throw new Error('Unexpected preview content type');
  return response.blob();
}

/** Retrieve a server-generated, already-watermarked PDF. Never request the
 * original S3 object or attach access tokens to a public download URL. */
export async function authorizedPdfRequest(path:string):Promise<Blob>{
  if (!apiOrigin || (!studentCookieSession && (!token || Date.now() >= expiry - 30_000))) throw new Error('Session expired. Sign in again.');
  let response:Response;
  try {
    response=await fetch(`${apiOrigin}${path}`,{
      headers:studentCookieSession?{}:{Authorization:`Bearer ${token}`},
      credentials:studentCookieSession?'include':'omit',cache:'no-store',
    });
  } catch {throw new Error('DocHub API is unavailable.');}
  if(!response.ok){
    const body:unknown=await response.json().catch(()=>({}));
    const message=body&&typeof body==='object'&&'message' in body&&typeof body.message==='string'?body.message:'Unable to prepare personalized PDF';
    throw new Error(response.status===401?'Session expired. Sign in again.':message);
  }
  if(!(response.headers.get('content-type')??'').startsWith('application/pdf'))throw new Error('Invalid protected PDF response');
  return response.blob();
}

/** Student sessions are opaque HttpOnly cookies, not client-side JWTs. */
async function studentAuthRequest<T>(path:string, body?:unknown):Promise<T> {
  if(!apiOrigin) throw new Error('DocHub API is not configured');
  const response=await fetch(`${apiOrigin}${path}`,{
    method:body===undefined?'GET':'POST',
    credentials:'include',cache:'no-store',
    headers:body===undefined?{}:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await response.json().catch(()=>({})) as {message?:string};
  if(!response.ok) throw new Error(data.message ?? (response.status===401?'Invalid sign-in or expired session':'Unable to complete request'));
  return data as T;
}
export async function studentSessionAccount():Promise<Account|null> {
  try {
    const account=await studentAuthRequest<Account>('/auth/student/me');
    if(!account.roles.includes('STUDENT')) return null;
    studentCookieSession=true;
    return account;
  } catch{return null;}
}
export async function studentPasswordLogin(email:string,password:string):Promise<Account> {
  const account=await studentAuthRequest<Account>('/auth/student/login',{email,password});
  studentCookieSession=true;
  return account;
}
export async function requestStudentLink(email:string,purpose:'activate'|'reset'):Promise<void> {
  await studentAuthRequest<{message:string}>(`/auth/student/${purpose}/request`,{email});
}
export async function completeStudentLink(token:string,password:string,purpose:'activate'|'reset'):Promise<void> {
  await studentAuthRequest<{status:string}>(`/auth/student/${purpose}/complete`,{token,password});
}
export async function studentPasswordLogout():Promise<void> {
  try {await studentAuthRequest('/auth/student/logout',{});} finally {studentCookieSession=false;}
}
