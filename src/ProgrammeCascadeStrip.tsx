import {useEffect,useState} from 'react';
import {BookOpen,CheckCircle2,AlertCircle,RefreshCw} from 'lucide-react';
import {academicClient,type ProgrammeContext} from './academic-client';
import './programme-cascade-strip.css';

/** Read-only, server-resolved academic context shared by existing V20 admin screens. */
export function ProgrammeCascadeStrip({programmeId}:{programmeId:string}) {
  const [context,setContext]=useState<ProgrammeContext|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    setContext(null);setError('');
    if(!programmeId){setLoading(false);return;}
    setLoading(true);
    void academicClient.getProgrammeContext(programmeId)
      .then(result=>{if(!cancelled)setContext(result)})
      .catch(cause=>{if(!cancelled)setError(cause instanceof Error?cause.message:'Could not resolve academic mapping')})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return ()=>{cancelled=true};
  },[programmeId]);
  return <section className="cascade-context-strip" aria-label="Inherited academic mapping">
    <div className="cascade-context-heading"><BookOpen size={17} aria-hidden="true"/><strong>Programme mapping</strong>
      {!programmeId&&<span className="cascade-context-subtle">Select a programme to show its mapped course, subjects and plans.</span>}
      {loading&&<span className="cascade-context-subtle" role="status"><RefreshCw size={13} aria-hidden="true"/> Loading mapping…</span>}
      {context&&<span className={`cascade-context-status ${context.canPublish?'approved':'blocked'}`}>
        {context.canPublish?<CheckCircle2 size={14} aria-hidden="true"/>:<AlertCircle size={14} aria-hidden="true"/>}
        {context.canPublish?'Approved':'Approval required'}
      </span>}
    </div>
    {error&&<p className="cascade-context-error" role="alert">{error}</p>}
    {context&&<div className="cascade-context-details">
      <div className="cascade-context-field"><small>Course (automatic)</small><strong>{context.courses.map(c=>c.name).join(', ')||'Not mapped'}</strong></div>
      <div className="cascade-context-field"><small>Mapped subjects</small><span>{context.subjects.map(s=>s.name).join(' · ')||'None'}</span></div>
      <div className="cascade-context-field"><small>Subscribed plans</small><span>{context.plans.map(p=>p.name).join(' · ')||'None'}</span></div>
    </div>}
  </section>;
}
