import {useEffect,useState} from 'react';
import {LogIn,LogOut,ShieldCheck,Mail,KeyRound,ArrowLeft} from 'lucide-react';
import App from './App';
import StudentDocumentsWorkspace from './StudentDocumentsWorkspace';
import {
  configured,consumeLogin,getAccount,logout,startLogin,studentSessionAccount,
  studentPasswordLogin,studentPasswordLogout,requestStudentLink,completeStudentLink,type Account,
} from './auth-client';
import type {Role} from './data';
import './auth.css';
const roleMap:Record<Account['roles'][number],Role>={SUPER_ADMIN:'Super Admin',CONTENT_MANAGER:'Content Manager',FACULTY:'Faculty',STUDENT:'Student'};
type StudentMode='login'|'activate'|'reset'|'finish-activate'|'finish-reset';
function consumeStudentLink():{mode:StudentMode;token:string}|null {
  const raw=window.location.hash.startsWith('#')?window.location.hash.slice(1):'';
  const params=new URLSearchParams(raw),purpose=params.get('student-action'),token=params.get('token');
  if(!token||(purpose!=='activate'&&purpose!=='reset'))return null;
  history.replaceState(null,'',`${location.pathname}${location.search}`);
  return {mode:purpose==='activate'?'finish-activate':'finish-reset',token};
}
let initialization:Promise<{account:Account|null;student:boolean}>|null=null;
function initialize():Promise<{account:Account|null;student:boolean}> {
  if(!initialization)initialization=(async()=>{
    if(await consumeLogin())return {account:await getAccount(),student:false};
    const student=await studentSessionAccount();
    return {account:student,student:Boolean(student)};
  })();
  return initialization;
}
export default function AuthGate(){
  const [account,setAccount]=useState<Account|null>(null);
  const [status,setStatus]=useState<'checking'|'signedOut'|'ready'>('checking');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [selected,setSelected]=useState<Role|null>(null);
  const [studentSession,setStudentSession]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [mode,setMode]=useState<StudentMode>('login');
  const [linkToken,setLinkToken]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const link=consumeStudentLink();
    if(link){setMode(link.mode);setLinkToken(link.token);}
    let alive=true;
    initialize().then(result=>{
      if(!alive)return;
      if(result.account){setAccount(result.account);setStudentSession(result.student);setStatus('ready');}
      else setStatus('signedOut');
    }).catch(err=>{if(alive){setError(err instanceof Error?err.message:'Unable to verify session');setStatus('signedOut');}});
    return()=>{alive=false};
  },[]);
  const roles=account?.roles.map(r=>roleMap[r])??[];
  const signOut=()=>{
    if(studentSession)void studentPasswordLogout().catch(()=>{});
    logout();setAccount(null);setSelected(null);setStudentSession(false);setPassword('');setConfirm('');setStatus('signedOut');
  };
  async function submitStudent(){
    setBusy(true);setError('');setNotice('');
    try{
      if(mode==='login'){
        const user=await studentPasswordLogin(email.trim().toLowerCase(),password);
        setAccount(user);setStudentSession(true);setSelected('Student');setPassword('');setStatus('ready');
      }else if(mode==='activate'||mode==='reset'){
        await requestStudentLink(email.trim().toLowerCase(),mode);
        setNotice('If your email is eligible, a one-time link will arrive shortly. Check your inbox and spam folder.');
      }else{
        if(password!==confirm)throw new Error('Passwords do not match');
        await completeStudentLink(linkToken,password,mode==='finish-activate'?'activate':'reset');
        setPassword('');setConfirm('');setLinkToken('');setMode('login');
        setNotice('Password saved. Sign in using your email and new password.');
      }
    }catch(err){setError(err instanceof Error?err.message:'Unable to complete student sign-in');}
    finally{setBusy(false);}
  }
  return <>
    {status==='checking'?<main className="auth-page" role="status">Checking secure session…</main>:
    status==='ready'&&account&&roles.length>0?
      selected||roles.length===1?<>
        <div className="auth-session-bar"><span><ShieldCheck size={15}/> Authorized session · {selected??roles[0]}</span><div>{roles.length>1&&<button onClick={()=>setSelected(null)}>Switch profile</button>}<button onClick={signOut}><LogOut size={15}/> Sign out</button></div></div>
        {(selected??roles[0])==='Student'?
          <StudentDocumentsWorkspace key={`${account.userId}:student`} studentName={account.displayName||'Student'} initialView="Learning" onSwitchProfile={roles.some(r=>r==='Super Admin'||r==='Content Manager')?()=>setSelected(null):undefined}/>
          :<App key={`${account.userId}:${selected??roles[0]}`} initialRole={selected??roles[0]} allowedRoles={roles} onLogout={signOut}/>}
      </>:
      <main className="auth-page"><section className="auth-card"><ShieldCheck size={32}/><h1>Select your workspace</h1><p>Only authorized roles are shown.</p><div className="auth-profiles">{roles.map(r=><button key={r} onClick={()=>setSelected(r)}>{r}</button>)}</div><button className="auth-link" onClick={signOut}>Sign out</button></section></main>:
      <main className="auth-page"><section className="auth-card">
        <img src="/doctutorials-mark.png" alt="DocTutorials"/><h1>DocHub</h1>
        <p>{mode==='login'?'Student sign-in':mode==='activate'?'Activate your student account':mode==='reset'?'Reset your password':'Choose a password for your student account'}</p>
        {error&&<p role="alert" className="auth-error">{error}</p>}
        {notice&&<p role="status" className="auth-otp-info">{notice}</p>}
        <form className="auth-otp-form" onSubmit={e=>{e.preventDefault();void submitStudent()}}>
          {mode!=='finish-activate'&&mode!=='finish-reset'&&<label>Email address<input type="email" required maxLength={254} autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="student@example.com"/></label>}
          {(mode==='login'||mode==='finish-activate'||mode==='finish-reset')&&<label>Password<input type="password" required minLength={mode==='login'?1:12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='login'?'Enter your password':'At least 12 characters'}/></label>}
          {(mode==='finish-activate'||mode==='finish-reset')&&<label>Confirm password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Re-enter your password"/></label>}
          <button className="auth-primary" type="submit" disabled={busy||!import.meta.env.VITE_API_ORIGIN}>
            {mode==='login'?<LogIn size={18}/>:mode==='activate'||mode==='reset'?<Mail size={18}/>:<KeyRound size={18}/>}
            {busy?'Please wait…':mode==='login'?'Sign in':mode==='activate'||mode==='reset'?'Email secure link':'Save password'}
          </button>
        </form>
        <div className="auth-secondary-actions">
          {mode==='login'?<><button className="auth-link" onClick={()=>{setMode('activate');setError('');setNotice('')}}>First-time activation</button><button className="auth-link" onClick={()=>{setMode('reset');setError('');setNotice('')}}>Forgot password?</button></>:
            <button className="auth-link" onClick={()=>{setMode('login');setError('');setNotice('');setLinkToken('');setPassword('');setConfirm('')}}><ArrowLeft size={14}/> Back to sign-in</button>}
        </div>
        <div className="auth-admin-separator">Administrator / employee</div>
        <button disabled={!configured} className="auth-link auth-admin-login" onClick={()=>{setError('');void startLogin().catch(e=>setError(e instanceof Error?e.message:'Unable to start admin sign-in'));}}>Sign in to administration</button>
      </section></main>}
  </>;
}
