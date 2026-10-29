import {useCallback,useEffect,useMemo,useState} from 'react';
import {CalendarDays,Plus,Pencil,RefreshCw,CheckCircle2,ArrowUpRight,AlertCircle} from 'lucide-react';
import {academicClient,type AcademicCatalog,type ProgrammeContext} from './academic-client';
import {sessionsClient,type LiveSession,type LiveSessionInput,type SessionPlatform,type SessionStatus,type SessionTab} from './sessions-client';
import { ProgrammeCascadeStrip } from './ProgrammeCascadeStrip';
import { programmesForCourse } from './academic-selection';
import './sessions.css';
const blank:AcademicCatalog={courses:[],programmes:[],subjects:[],plans:[]};
const todayIST=()=>new Date(Date.now()+330*60_000).toISOString().slice(0,10);
const initial=():LiveSessionInput=>({courseId:'',programmeId:'',subjectId:'',topic:'',facultyName:'',facultyId:null,startAt:`${todayIST()}T10:00:00+05:30`,endAt:`${todayIST()}T11:00:00+05:30`,platform:'DOCTUTORIALS_APP',youtubeUrl:null,remarks:null,planIds:[],status:'DRAFT'});
function localTime(value:string){const d=new Date(value);if(Number.isNaN(+d))return '';return new Date(d.getTime()+330*60_000).toISOString().slice(0,16)}
function isoTime(value:string){return new Date(value+'+05:30').toISOString()}
const tabs:SessionTab[]=['Today','Upcoming','Completed','All'];
const statuses:SessionStatus[]=['DRAFT','SCHEDULED','POSTPONED','CANCELLED','COMPLETED'];
const platforms:Array<[SessionPlatform,string]>=[['DOCTUTORIALS_APP','DocTutorials App'],['YOUTUBE','YouTube'],['ZOOM','Zoom'],['DTLC','DTLC']];
export function SessionsWorkspace({onCount}:{onCount?:(total:number)=>void}){
  const[catalog,setCatalog]=useState<AcademicCatalog>(blank),[rows,setRows]=useState<LiveSession[]>([]);
  const[tab,setTab]=useState<SessionTab>('Today'),[filterCourse,setFilterCourse]=useState(''),[filterProgramme,setFilterProgramme]=useState(''),[search,setSearch]=useState('');
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const[editor,setEditor]=useState<LiveSession|null|undefined>(undefined),[form,setForm]=useState<LiveSessionInput>(initial);
  const [startLocal,setStartLocal]=useState(`${todayIST()}T10:00`),[endLocal,setEndLocal]=useState(`${todayIST()}T11:00`);
  const [programmeContext,setProgrammeContext]=useState<ProgrammeContext|null>(null);
  const [contextLoading,setContextLoading]=useState(false);
  const [contextError,setContextError]=useState('');
  const [facultyEntry,setFacultyEntry]=useState(false),[facultyDraft,setFacultyDraft]=useState(''),[facultyBusy,setFacultyBusy]=useState(false);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const [a,b]=await Promise.all([academicClient.getCatalog(),sessionsClient.adminList({courseId:filterCourse||undefined,programmeId:filterProgramme||undefined,tab,q:search.trim()||undefined})]);setCatalog(a);setRows(b.items);if(onCount)void sessionsClient.summary().then(result=>onCount(result.total)).catch(()=>{})}catch(c){setError(c instanceof Error?c.message:'Unable to load sessions')}finally{setLoading(false)}},[filterCourse,filterProgramme,search,tab,onCount]);
  useEffect(()=>{const id=setTimeout(()=>void load(),180);return()=>clearTimeout(id)},[load]);
  const programmes=programmesForCourse(catalog.programmes.filter(p=>p.locked&&!p.hidden&&!p.accessLocked&&!p.archivedAt),form.courseId);
  const chosen=programmeContext?.programme;
  const mappedSubjects=programmeContext?.subjects??[];
  const mappedPlans=programmeContext?.plans??[];
  // The context request is cancellable so switching programmes cannot apply stale choices.
  useEffect(()=>{
    if(editor===undefined || !form.programmeId){setProgrammeContext(null);setContextLoading(false);return;}
    let cancelled=false;
    setContextLoading(true);setContextError('');setProgrammeContext(null);
    void academicClient.getProgrammeContext(form.programmeId).then(context=>{
      if(cancelled)return;
      if(context.courses.length!==1 || context.courses[0]?.id!==form.courseId){
        setContextError('The programme no longer belongs to the selected course. Choose its course again.');
        setProgrammeContext(null);
        return;
      }
      setProgrammeContext(context);
      setForm(previous=>{
        if(previous.programmeId!==context.programme.id)return previous;
        const validSubjects=new Set(context.subjects.map(subject=>subject.id));
        const validPlans=new Set(context.plans.map(plan=>plan.id));
        const originalEdit=!!editor && editor.programmeId===context.programme.id;
        const targets=originalEdit?previous.planIds.filter(id=>validPlans.has(id)):context.plans.map(plan=>plan.id);
        return {...previous,
          courseId:context.courses[0]?.id??'',
          mappingRevision:context.programme.mappingRevision,
          subjectId:validSubjects.has(previous.subjectId)?previous.subjectId:context.subjects.length===1?context.subjects[0]!.id:'',
          planIds:targets,
        };
      });
    }).catch(cause=>{if(!cancelled)setContextError(cause instanceof Error?cause.message:'Unable to load programme mapping')})
      .finally(()=>{if(!cancelled)setContextLoading(false)});
    return()=>{cancelled=true};
  },[editor,form.programmeId]);
  const filterProgrammes=programmesForCourse(catalog.programmes,filterCourse);
  const edit=(item?:LiveSession)=>{setError('');setContextError('');setProgrammeContext(null);setEditor(item??null);if(item){setForm({...item});setStartLocal(localTime(item.startAt));setEndLocal(localTime(item.endAt))}else{setForm({...initial(),courseId:filterCourse,programmeId:filterProgramme});setStartLocal(`${todayIST()}T10:00`);setEndLocal(`${todayIST()}T11:00`)}};
  const addFaculty=async()=>{if(facultyDraft.trim().length<2)return setError('Enter a faculty name');
    setFacultyBusy(true);setError('');try{const created=await academicClient.create('Faculty',facultyDraft.trim());
      const next=await academicClient.getCatalog();setCatalog(next);
      const f=next.faculty?.find(f=>f.id===created.id);if(f)setForm(v=>({...v,facultyId:f.id,facultyName:f.name}));
      setFacultyDraft('');setFacultyEntry(false);
    }catch(c){setError(c instanceof Error?c.message:'Unable to create faculty')}finally{setFacultyBusy(false)};
  };
  const change=<K extends keyof LiveSessionInput>(field:K,value:LiveSessionInput[K])=>setForm(prev=>({...prev,[field]:value}));
  const save=async()=>{if(contextLoading||!programmeContext?.canPublish||!form.courseId||!form.topic.trim()||!form.facultyName.trim()||!form.subjectId||!form.planIds.length)return setError('Complete topic, faculty, subject and at least one plan');
    if(!form.facultyId)return setError('Select a faculty from the directory or add one');
    if(form.platform==='YOUTUBE'&&!form.youtubeUrl)return setError('A YouTube session needs a valid link');
    if(!startLocal||!endLocal||endLocal<=startLocal)return setError('End time must be after the session start');
    setBusy(true);setError('');try{const payload={...form,startAt:isoTime(startLocal),endAt:isoTime(endLocal),youtubeUrl:form.platform==='YOUTUBE'?form.youtubeUrl:null};
      if(editor)await sessionsClient.update(payload,editor);else await sessionsClient.create(payload);
      setEditor(undefined);setNotice('Session saved. Publish it to show it to subscribed plans.');await load();
    }catch(c){setError(c instanceof Error?c.message:'Unable to save session')}finally{setBusy(false)} };
  const publish=async(s:LiveSession,publish:boolean)=>{setBusy(true);setError('');try{await sessionsClient.publication(s,publish);setNotice(publish?'Session published to selected plans':'Session unpublished');await load()}catch(c){setError(c instanceof Error?c.message:'Could not change publication')}finally{setBusy(false)}};
  const format=(v:string)=>new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  return <section className="sessions-workspace">
    <div className="a-titlebar"><div><h1>Session management</h1><p>Schedule, reschedule and publish live sessions to selected subscribed plans.</p></div><div className="a-actions"><button className="a-btn" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button><button className="a-btn primary" onClick={()=>edit()}><Plus size={16}/> Add session</button></div></div>
    {error&&<div className="session-error" role="alert"><AlertCircle size={15}/>{error}</div>}{notice&&<div className="session-success" role="status"><CheckCircle2 size={15}/>{notice}</div>}
    <div className="a-bar session-toolbar"><div className="a-tabs">{tabs.map(x=><button className={tab===x?'on':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</div><label>Course<select aria-label="Course filter" value={filterCourse} onChange={e=>{setFilterCourse(e.target.value);setFilterProgramme('')}}><option value="">All courses</option>{catalog.courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Programme<select aria-label="Programme filter" value={filterProgramme} disabled={!filterCourse} onChange={e=>setFilterProgramme(e.target.value)}><option value="">{filterCourse?'All programmes':'Select course first'}</option>{filterProgrammes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="a-search"><input placeholder="Find topic or faculty" aria-label="Search sessions" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
    <ProgrammeCascadeStrip programmeId={filterProgramme} />
    <section className="a-panel"><div className="a-table-wrap"><table><thead><tr><th>Date / time</th><th>Topic / Subject</th><th>Programme</th><th>Faculty</th><th>Platform</th><th>Plans</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {rows.map(s=><tr key={s.id}><td>{format(s.startAt)}</td><td><strong>{s.topic}</strong><small>{catalog.subjects.find(a=>a.id===s.subjectId)?.name??'Subject'}</small></td><td>{catalog.programmes.find(a=>a.id===s.programmeId)?.name??'Programme'}<small>{catalog.courses.find(a=>a.id===s.courseId)?.name??'Course'}</small></td><td>{s.facultyName}</td><td>{platforms.find(p=>p[0]===s.platform)?.[1]}{s.youtubeUrl&&<a href={s.youtubeUrl} target="_blank" rel="noopener noreferrer" className="session-link">View link <ArrowUpRight size={13}/></a>}</td><td>{s.planIds.length}</td><td><span className={`a-tag ${s.status==='COMPLETED'?'green':s.status==='CANCELLED'?'red':''}`}>{s.status}</span><small>{s.publishedAt?'Published':'Not published'}</small></td><td><div className="session-actions"><button className="a-btn" onClick={()=>edit(s)} disabled={busy}><Pencil size={14}/> Edit</button><button className="a-btn" onClick={()=>void publish(s,!s.publishedAt)} disabled={busy||(!s.publishedAt&&s.status==='DRAFT')}>{s.publishedAt?'Unpublish':'Publish'}</button></div></td></tr>)}
    </tbody></table></div>{!loading&&!rows.length&&<p className="session-empty">No sessions found for this view.</p>}{loading&&<p className="session-empty" role="status">Loading sessions…</p>}</section>
    {editor!==undefined&&<div className="a-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEditor(undefined)}}><div className="a-modal session-drawer" role="dialog" aria-modal="true" aria-label="Session editor"><button className="a-modal-x" disabled={busy} onClick={()=>setEditor(undefined)}>×</button><h2>{editor?'Edit session':'New session'}</h2><p>Saved sessions remain private until explicitly published to selected plans.</p>
      <div className="session-form"><label>Course<select aria-label="Session course" disabled={!!editor||busy} value={form.courseId} onChange={e=>{const courseId=e.target.value;setProgrammeContext(null);setContextError('');setForm(v=>({...v,courseId,programmeId:'',subjectId:'',planIds:[],mappingRevision:undefined}))}}><option value="">Select course</option>{catalog.courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Programme<select aria-label="Session programme" disabled={!form.courseId||!!editor||busy} value={form.programmeId} onChange={e=>{const id=e.target.value;setProgrammeContext(null);setContextError('');setForm(v=>({...v,programmeId:id,subjectId:'',planIds:[],mappingRevision:undefined}))}}><option value="">{form.courseId?'Select programme':'Select course first'}</option>{programmes.map(p=><option key={p.id} value={p.id} disabled={!p.locked}>{p.name}{p.locked?'':' — approval required'}</option>)}</select></label>
      {form.courseId&&!programmes.length&&<p className="session-wide session-error" role="status">No programmes are mapped to this course. Add and lock a programme in Academic Mapping.</p>}
      {contextLoading&&<p className="session-wide" role="status">Resolving mapped course, subjects and plans…</p>}
      {contextError&&<p className="session-wide session-error" role="alert">{contextError}</p>}
      {programmeContext&&!programmeContext.canPublish&&<p className="session-wide session-error">Programme mapping is not approved. Lock a complete mapping before scheduling.</p>}
      <label>Subject<select aria-label="Session subject" disabled={!programmeContext||contextLoading||busy} value={form.subjectId} onChange={e=>change('subjectId',e.target.value)}><option value="">Select subject</option>{mappedSubjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Faculty name<div className="session-faculty-picker"><select value={form.facultyId??''} onChange={e=>{const f=catalog.faculty?.find(v=>v.id===e.target.value);setForm(v=>({...v,facultyId:f?.id??null,facultyName:f?.name??''}));}}>
        <option value="">Select faculty</option>{(catalog.faculty??[]).filter(f=>!f.hidden&&!f.accessLocked&&!f.archivedAt).map(f=><option value={f.id} key={f.id}>{f.name}</option>)}
      </select><button type="button" className="a-btn" onClick={()=>setFacultyEntry(x=>!x)}>+ Add</button></div>
      {facultyEntry&&<span className="session-faculty-picker"><input value={facultyDraft} onChange={e=>setFacultyDraft(e.target.value)} placeholder="New faculty name"/><button type="button" className="a-btn" disabled={facultyBusy} onClick={()=>void addFaculty()}>{facultyBusy?'Adding…':'Save'}</button></span>}
      {!!form.facultyName&&!form.facultyId&&<small>Existing session faculty: {form.facultyName}. Choose a directory entry to link.</small>}</label>
      <label className="session-wide">Topic<input maxLength={240} value={form.topic} onChange={e=>change('topic',e.target.value)}/></label>
      <label>Date and start time<input type="datetime-local" value={startLocal} onChange={e=>setStartLocal(e.target.value)}/></label><label>End date and time<input type="datetime-local" value={endLocal} onChange={e=>setEndLocal(e.target.value)}/></label>
      <label>Platform<select value={form.platform} onChange={e=>{const p=e.target.value as SessionPlatform;setForm(v=>({...v,platform:p,youtubeUrl:p==='YOUTUBE'?v.youtubeUrl:null}))}}>{platforms.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Status<select value={form.status} onChange={e=>change('status',e.target.value as SessionStatus)}>{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
      {form.platform==='YOUTUBE'&&<label className="session-wide">YouTube link<input type="url" placeholder="https://www.youtube.com/watch?v=..." value={form.youtubeUrl??''} onChange={e=>change('youtubeUrl',e.target.value||null)}/></label>}
      <label className="session-wide">Remarks<textarea rows={3} maxLength={2000} value={form.remarks??''} onChange={e=>change('remarks',e.target.value||null)}/></label></div>
      <h3>Publish to subscribed plans</h3><p className="session-target-info">All plans mapped to this course and programme are initially checked. Uncheck any plan to narrow the audience. Student enrollment is checked separately.</p><div className="a-actions"><button className="a-btn" type="button" disabled={!programmeContext||busy} onClick={()=>change('planIds',mappedPlans.map(p=>p.id))}>Check all</button><button className="a-btn" type="button" disabled={!programmeContext||busy} onClick={()=>change('planIds',[])}>Uncheck all</button><span className="session-target-info">{form.planIds.length} of {mappedPlans.length} selected</span></div><div className="a-check-grid">{mappedPlans.map(p=><label className="a-check" key={p.id}><input type="checkbox" disabled={busy||contextLoading||!programmeContext?.canPublish} checked={form.planIds.includes(p.id)} onChange={e=>change('planIds',e.target.checked?[...form.planIds,p.id]:form.planIds.filter(id=>id!==p.id))}/>{p.name}</label>)}</div>
      {error&&<p role="alert" className="session-error">{error}</p>}<div className="a-actions"><button className="a-btn" onClick={()=>setEditor(undefined)} disabled={busy}>Cancel</button><button className="a-btn primary" onClick={()=>void save()} disabled={busy||contextLoading||!chosen||!programmeContext?.canPublish||!form.courseId||!form.subjectId||!form.planIds.length}>{busy?'Saving…':'Save session'}</button></div>
    </div></div>}
  </section>;
}
