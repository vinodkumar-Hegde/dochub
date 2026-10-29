import { useState } from 'react';
import { CalendarDays, ExternalLink, LockKeyhole, CheckCircle2 } from 'lucide-react';
import type { StudentAttendanceIntent, StudentLiveSession, SessionTab } from './sessions-client';
import './student-documents.css';

type Props={items:StudentLiveSession[];tab:SessionTab;onTab:(next:SessionTab)=>void;loading:boolean;error:string;onAttendance:(id:string,response:StudentAttendanceIntent)=>Promise<void>;savingId:string|null;nextPage:number|null;onMore:()=>void};
const tabs:SessionTab[]=['All','Today','Completed','Scheduled'];
const date=(value:string)=>new Date(value).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});
const time=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
const label=(intent:StudentAttendanceIntent)=>({WILL_ATTEND:'Will attend',NOT_AVAILABLE:'Not available',WATCH_RECORDING:'Watch recording'}[intent]);
const statusLabel=(status:StudentLiveSession['status'])=>status.charAt(0)+status.slice(1).toLowerCase();

export default function StudentSessionsTable({items,tab,onTab,loading,error,onAttendance,savingId,nextPage,onMore}:Props){
 const [choices,setChoices]=useState<Record<string,StudentAttendanceIntent|''>>({});
 const [confirmId,setConfirmId]=useState<string|null>(null);
 return <section className="student-session-section" aria-label="Student schedule">
  <nav className="student-session-tabs" aria-label="Schedule filters">{tabs.map(t=><button type="button" key={t} className={tab===t?'on':''} onClick={()=>{setConfirmId(null);onTab(t)}} disabled={loading} aria-pressed={tab===t}>{t}</button>)}</nav>
  <p className="student-attendance-guidance">Submit your response before the session ends. Submitted responses cannot be changed; ended sessions are read-only. A response is not verification of attendance.</p>
  {error&&<p role="alert" className="student-api-notice">{error}</p>}
  <div className="student-session-table-wrap" role="region" aria-label="Session schedule table" tabIndex={0}>
    <table className="student-session-table"><thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Faculty name</th><th scope="col">Subject</th><th scope="col">Programme name</th><th scope="col">Topic</th><th scope="col">Status</th><th scope="col">Attendance</th></tr></thead>
    <tbody>{items.map(s=><tr key={s.id} className={`student-session-row status-${s.status.toLowerCase()}`}>
     <td className="student-session-date-cell">{date(s.startAt)}</td><td className="student-session-time-cell">{time(s.startAt)} – {time(s.endAt)}</td>
     <td>{s.facultyName}</td><td>{s.subjectName||'—'}</td><td>{s.programmeName||'—'}</td>
     <td><strong>{s.topic}</strong>{s.platform==='YOUTUBE'&&s.youtubeUrl&&s.status!=='CANCELLED'&&s.status!=='POSTPONED'&&<a className="student-session-link" href={s.youtubeUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/> Watch on YouTube</a>}</td>
     <td><span className={`student-session-status status-${s.status.toLowerCase()}`}>{statusLabel(s.status)}</span></td>
     <td>{s.attendance?<span className="student-attendance-locked" title="Your response is final"><LockKeyhole size={14}/><span>{label(s.attendance.response)}<small>Submitted · locked</small></span></span>:
       s.status==='SCHEDULED'&&Date.parse(s.endAt)>Date.now()?<div className="student-attendance-form">
        <select value={choices[s.id]??''} aria-label={`Attendance response for ${s.topic}`} disabled={savingId!==null} onChange={e=>{setChoices(v=>({...v,[s.id]:e.target.value as StudentAttendanceIntent|''}));setConfirmId(null)}}><option value="">Choose response</option><option value="WILL_ATTEND">Will attend</option><option value="NOT_AVAILABLE">Not available</option><option value="WATCH_RECORDING">Watch recording</option></select>
        {confirmId===s.id?<div className="student-attendance-actions"><span className="student-attendance-final">Final submission?</span><button type="button" disabled={savingId!==null} onClick={()=>{const choice=choices[s.id];if(choice)void onAttendance(s.id,choice).then(()=>setConfirmId(null)).catch(()=>{})}}>Confirm</button><button type="button" disabled={savingId!==null} onClick={()=>setConfirmId(null)}>Cancel</button></div>:<button type="button" disabled={!choices[s.id]||savingId!==null} onClick={()=>setConfirmId(s.id)}>{savingId===s.id?'Saving…':'Submit'}</button>}
       </div>:<span className="student-session-no-link"><LockKeyhole size={13}/>{Date.parse(s.endAt)<=Date.now()||s.status==='COMPLETED'?'Session ended · Read only':'Unavailable'}</span>}</td>
    </tr>)}</tbody></table>
   {!loading&&!items.length&&!error&&<p className="student-session-table-empty">No sessions in the {tab.toLowerCase()} view.</p>}
  </div>
  {loading&&<p role="status" className="student-session-load"><CalendarDays size={16}/> Loading schedule…</p>}
  {nextPage!==null&&!loading&&<div className="student-session-more"><button type="button" onClick={onMore}>Load more sessions</button></div>}
  <p className="student-attendance-footer"><CheckCircle2 size={14}/> Only sessions authorized by your active subscriptions are shown.</p>
 </section>
}
