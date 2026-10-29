import {WorkspaceAccount} from './WorkspaceHeader';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,CalendarDays,Check,FileText,LogOut,Mail,RefreshCw,ShieldCheck} from 'lucide-react';
import App from './App';
import StudentDocumentsWorkspace from './StudentDocumentsWorkspace';
import StudentProfile from './StudentProfile';
import {emailOtpSession,requestEmailOtp,verifyEmailOtp,emailOtpLogout,logout,type Account} from './auth-client';
import type {Role} from './data';
import './auth.css';
const roleMap:Record<Account['roles'][number],Role>={SUPER_ADMIN:'Super Admin',CONTENT_MANAGER:'Content Manager',FACULTY:'Faculty',STUDENT:'Student'};
let initialization:Promise<Account|null>|null=null;
export default function AuthGate(){
 const [account,setAccount]=useState<Account|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(''),[error,setError]=useState('');
 const [resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now()),[expiresAt,setExpiresAt]=useState(0);
 const [showProfile,setShowProfile]=useState(false),[selected,setSelected]=useState<Role|null>(null);
 const codeInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{let alive=true;initialization??=emailOtpSession();initialization.then(value=>{if(alive){setAccount(value);setChecking(false)}}).catch(()=>{if(alive)setChecking(false)});return()=>{alive=false}},[]);
 useEffect(()=>{if(challenge)codeInput.current?.focus()},[challenge]);
 useEffect(()=>{if(!challenge)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[challenge]);
 const refreshAccount=()=>{void emailOtpSession().then(next=>{if(next)setAccount(next);else{setAccount(null);initialization=null}})};
 useEffect(()=>{
  if(!account)return;let alive=true;
  const refresh=()=>{void emailOtpSession().then(next=>{if(alive){setAccount(next);if(!next)initialization=null}}).catch(()=>{})};
  const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh)};
 },[Boolean(account)]);
 const signOut=async()=>{setBusy(true);try{await emailOtpLogout();logout();initialization=null;setAccount(null);setSelected(null);setShowProfile(false);setChallenge('');setCode('');setError('')}catch(cause){setError(cause instanceof Error?cause.message:'Unable to sign out')}finally{setBusy(false)}};
 const sendCode=async()=>{
  setBusy(true);setError('');
  try{const response=await requestEmailOtp(email.trim().toLowerCase());setChallenge(response.challengeId);setCode('');setNow(Date.now());setResendAt(Date.now()+response.resendAfterSeconds*1000);setExpiresAt(Date.now()+response.expiresInSeconds*1000)}
  catch(cause){setError(cause instanceof Error?cause.message:'Unable to send a sign-in code')}
  finally{setBusy(false)};
 };
 const verify=async()=>{
  setBusy(true);setError('');
  try{const value=await verifyEmailOtp(challenge,code);initialization=Promise.resolve(value);setAccount(value);setCode('');setChallenge('');setSelected(null);setShowProfile(false)}
  catch(cause){setError(cause instanceof Error?cause.message:'Unable to verify your code')}
  finally{setBusy(false)};
 };
 const roles=account?.roles.map(r=>roleMap[r])??[];
 const role=selected??roles.find(r=>r==='Super Admin')??roles.find(r=>r==='Content Manager')??roles.find(r=>r==='Faculty')??roles[0];
 if(checking)return <main className="auth-loading" role="status"><img src="/doctutorials-brand.png" alt="DocTutorials"/><span>Opening DocHub…</span></main>;
 if(account&&role)return <WorkspaceAccount.Provider value={{account,onProfile:()=>setShowProfile(value=>!value),onSignOut:()=>void signOut()}}>{error&&<p className="auth-session-error" role="alert">{error}</p>}{showProfile||(role==='Student'&&account.featuresLocked)?<StudentProfile account={account} onRefresh={refreshAccount} onBack={()=>setShowProfile(false)}/>:role==='Student'?<StudentDocumentsWorkspace key={account.userId} studentName={account.displayName||'Student'} initialView="Home"/>:<App key={`${account.userId}:${role}`} initialRole={role} allowedRoles={roles} onLogout={()=>void signOut()}/>}</WorkspaceAccount.Provider>;
 const resendSeconds=Math.max(0,Math.ceil((resendAt-now)/1000)),expired=challenge&&now>=expiresAt;
 return <main className="auth-page"><section className="auth-story"><a className="auth-brand" href="/" aria-label="DocHub home"><img src="/doctutorials-brand.png" alt="DocTutorials"/><span>DocHub</span></a><div className="auth-story-copy"><span className="auth-eyebrow">THE DOCTUTORIALS LEARNING HUB</span><h1>Everything you need.<br/><em>One place to learn.</em></h1><p>Your learning materials, live sessions and important updates, together in DocHub.</p><div className="auth-features"><span><BookOpen size={17}/> Study materials</span><span><CalendarDays size={17}/> Live sessions</span><span><FileText size={17}/> Course updates</span></div></div><div className="auth-story-footer"><span className="auth-story-dot"/> Built for your learning journey</div></section><section className="auth-entry"><div className="auth-card"><div className="auth-entry-icon">{challenge?<ShieldCheck size={25}/>:<Mail size={25}/>}</div><span className="auth-eyebrow">WELCOME TO DOCHUB</span><h2>{challenge?'Check your email':'Sign in to continue'}</h2><p>{challenge?<>Enter the 6-digit code sent to <strong>{email.trim().toLowerCase()}</strong>.</>:'Enter your email and we’ll send you a one-time sign-in code.'}</p>{error&&<div className="auth-error" role="alert">{error}</div>}<form onSubmit={event=>{event.preventDefault();void(challenge?verify():sendCode())}}>{challenge?<label>Verification code<input ref={codeInput} className="auth-code-input" type="text" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="000000" disabled={busy}/></label>:<label>Email address<div className="auth-email-field"><Mail size={18}/><input autoFocus type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" disabled={busy}/></div></label>}<button className="auth-primary" type="submit" disabled={busy||!import.meta.env.VITE_API_ORIGIN||Boolean(challenge&&(code.length!==6||expired))}>{busy?<><RefreshCw className="auth-spin" size={17}/> Please wait…</>:<>{challenge?'Verify and sign in':'Send sign-in code'}<ArrowRight size={17}/></>}</button></form>{challenge?<div className="auth-code-actions"><p role="status">{expired?'This code has expired. Request a new one.':'Your code is valid for 10 minutes.'}</p><button disabled={busy||resendSeconds>0} onClick={()=>void sendCode()}>{resendSeconds?`Resend code in ${resendSeconds}s`:'Resend code'}</button><button disabled={busy} onClick={()=>{setChallenge('');setCode('');setError('')}}><ArrowLeft size={14}/> Use a different email</button></div>:<div className="auth-signin-note"><ShieldCheck size={15}/><span>Secure access with email verification</span></div>}<div className="auth-entry-footer">DocHub <span>by DocTutorials</span></div></div></section></main>;
}
