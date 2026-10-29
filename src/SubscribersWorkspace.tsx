import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertCircle,ArrowLeft,ArrowRight,Check,Plus,RefreshCw,Search,ShieldCheck,Users,X} from 'lucide-react';
import {academicClient,type AcademicCatalog,type AcademicProgramme} from './academic-client';
import {subscribersClient,type Subscriber,type SubscriberGrant} from './subscribers-client';
import './subscribers.css';
import {parseSubscriberCsv,type CsvStudent} from './subscriber-csv';
import {nextSubscriberGrants,type StudentAccessMode} from './subscriber-access-change';
import {FileSpreadsheet,Download} from 'lucide-react';

type Editor='create'|'single'|'bulk'|'import'|null;
const blank:AcademicCatalog={courses:[],plans:[],subjects:[],programmes:[]};
const unique=(items:string[])=>[...new Set(items)];
const valid=(g:SubscriberGrant)=>!g.activeFrom||new Date(g.activeFrom)<=new Date()?(!g.validUntil||new Date(g.validUntil)>new Date()):false;
const day=(date:string|null)=>date?date.slice(0,10):'';
const activationDay=(date:string|null)=>date?new Date(new Date(date).getTime()+330*60_000).toISOString().slice(0,10):'';
const buildGrants=(mapping:AcademicProgramme,subjects:string[],plans:string[],activeDate:string,expiry:string):SubscriberGrant[]=>
  plans.flatMap(planId=>subjects.map(subjectId=>({courseId:mapping.courseId,programmeId:mapping.id,subjectId,planId,activeFrom:activeDate?new Date(`${activeDate}T00:00:00+05:30`).toISOString():undefined,validUntil:expiry?new Date(`${expiry}T23:59:59.999+05:30`).toISOString():null})));

export function SubscribersWorkspace({onCounts}:{onCounts?:(total:number,active:number,byCourse:Record<string,number>)=>void}) {
  const callback=useRef(onCounts);callback.current=onCounts;
  const [catalog,setCatalog]=useState<AcademicCatalog>(blank);
  const [rows,setRows]=useState<Subscriber[]>([]);
  const [total,setTotal]=useState(0);
  const [cursor,setCursor]=useState<string|null>(null);
  const [history,setHistory]=useState<Array<string|null>>([]);
  const [currentCursor,setCurrentCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [courseFilter,setCourseFilter]=useState('');
  const [planFilter,setPlanFilter]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [editor,setEditor]=useState<Editor>(null);
  const [target,setTarget]=useState<Subscriber|null>(null);
  const [studentName,setStudentName]=useState('');
  const [studentEmail,setStudentEmail]=useState('');
  const [studentPhone,setStudentPhone]=useState('');
  const [accessMode,setAccessMode]=useState<StudentAccessMode>('replace');
  const [replaceCsvAccess,setReplaceCsvAccess]=useState(false);
  const [csvRows,setCsvRows]=useState<CsvStudent[]>([]);
  const [csvErrors,setCsvErrors]=useState<string[]>([]);
  const [csvName,setCsvName]=useState('');
  const [courseId,setCourseId]=useState('');
  const [programmeId,setProgrammeId]=useState('');
  const [subjects,setSubjects]=useState<string[]>([]);
  const [plans,setPlans]=useState<string[]>([]);
  const [expiry,setExpiry]=useState('');
  const [activationDate,setActivationDate]=useState(new Date(Date.now()+330*60_000).toISOString().slice(0,10));

  const refreshCounts=useCallback(async()=>{
    const summary=await subscribersClient.summary();
    callback.current?.(summary.total,summary.active,summary.byCourse);
  },[]);
  const load=useCallback(async (pageCursor:string|null=null)=>{
    setLoading(true);setError('');
    try {
      const [page,mapping]=await Promise.all([
        subscribersClient.list(search.trim()||undefined,pageCursor||undefined,courseFilter||undefined,planFilter||undefined),
        academicClient.getCatalog(),
      ]);
      setRows(page.items);setTotal(page.total);setCursor(page.nextCursor);setCatalog(mapping);
      await refreshCounts();
    } catch(cause){setError(cause instanceof Error?cause.message:'Unable to load subscribers');}
    finally{setLoading(false);}
  },[search,courseFilter,planFilter,refreshCounts]);
  useEffect(()=>{const timer=setTimeout(()=>{setHistory([]);setCurrentCursor(null);void load();},250);return()=>clearTimeout(timer);},[load]);
  const programmes=catalog.programmes.filter(p=>p.locked&&!p.hidden&&!p.accessLocked&&!p.archivedAt&&(!courseId||p.courseId===courseId));
  const chosen=programmes.find(p=>p.id===programmeId);
  const mappedSubjects=catalog.subjects.filter(s=>chosen?.subjectIds.includes(s.id)&&!s.hidden&&!s.accessLocked&&!s.archivedAt);
  const mappedPlans=catalog.plans.filter(p=>chosen?.planIds.includes(p.id)&&!p.hidden&&!p.accessLocked&&!p.archivedAt);
  const listPlans=catalog.plans.filter(p=>!courseFilter||p.courseId===courseFilter);
  const selectedRows=useMemo(()=>rows.filter(r=>selected.includes(r.id)),[rows,selected]);

  const chooseProgramme=(id:string,student:Subscriber|null=target,defaults=editor==='create')=>{
    setProgrammeId(id);
    const stored=student?.grants.filter(g=>g.programmeId===id)??[];
    const programme=catalog.programmes.find(p=>p.id===id);
    setSubjects(stored.length?unique(stored.map(g=>g.subjectId)):defaults?(programme?.subjectIds??[]):[]);
    setPlans(stored.length?unique(stored.map(g=>g.planId)):defaults?(programme?.planIds??[]):[]);
    const dates=unique(stored.map(g=>g.validUntil).filter((v):v is string=>Boolean(v)));
    setExpiry(dates.length===1?day(dates[0]!):'');
    const starts=unique(stored.map(g=>g.activeFrom).filter((v):v is string=>Boolean(v)));
    setActivationDate(starts.length===1?activationDay(starts[0]!):new Date(Date.now()+330*60_000).toISOString().slice(0,10));
  };
  const openImport=()=>{setReplaceCsvAccess(false);setEditor('import');setTarget(null);setError('');setCsvRows([]);setCsvErrors([]);setCsvName('');setExpiry('');const first=catalog.programmes.find(p=>p.locked&&!p.hidden&&!p.accessLocked&&!p.archivedAt);setCourseId(first?.courseId??'');chooseProgramme(first?.id??'',null,true);};
  const readCsv=async (file:File|null)=>{
    if(!file)return;
    if(!/\.csv$/i.test(file.name))return setCsvErrors(['Choose a CSV file saved from Excel or Google Sheets.']);
    if(file.size>1024*1024)return setCsvErrors(['CSV must be smaller than 1 MB.']);
    const parsed=parseSubscriberCsv(await file.text());setCsvRows(parsed.rows);setCsvErrors(parsed.errors);setCsvName(file.name);
  };
  const downloadTemplate=()=>{
    const csv='Student name,Email,Phone number,Course,Activation Date,Expiry Date\nExample Student,student@example.com,9999999999,NEET PG,2026-11-01,2027-10-31\n';
    const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='dochub-student-import-template.csv';link.click();URL.revokeObjectURL(link.href);
  };
  const openCreate=()=>{
    setEditor('create');setTarget(null);setError('');setStudentName('');setStudentEmail('');setStudentPhone('');setExpiry('');
    const first=catalog.programmes.find(p=>p.locked&&!p.hidden&&!p.accessLocked&&!p.archivedAt);
    setCourseId(first?.courseId??'');chooseProgramme(first?.id??'',null,true);
  };
  const openGrant=(mode:'single'|'bulk',student:Subscriber|null)=>{
    setAccessMode('replace');
    setTarget(student);setEditor(mode);setError('');
    const mapped=student?.grants[0];
    const first=catalog.programmes.find(p=>p.id===mapped?.programmeId&&p.locked)
      ??catalog.programmes.find(p=>p.locked);
    setCourseId(first?.courseId??'');
    chooseProgramme(first?.id??'',student);
  };
  const onCourse=(id:string)=>{
    setCourseId(id);
    const next=catalog.programmes.find(p=>p.courseId===id&&p.locked);
    chooseProgramme(next?.id??'');
  };
  const toggle=(value:string,values:string[],change:(next:string[])=>void)=>
    change(values.includes(value)?values.filter(v=>v!==value):[...values,value]);
  const run=async(action:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try {await action();setEditor(null);setSelected([]);await load();}
    catch(cause){setError(cause instanceof Error?cause.message:'Unable to save subscriber access');}
    finally{setBusy(false);}
  };
  const save=()=>{
    if(!chosen) return setError('Select an approved programme');
    if(plans.length===0||subjects.length===0) return setError('Select at least one subject and plan. For revocation, use Revoke programme.');
    const grants=buildGrants(chosen,subjects,plans,activationDate,expiry);
    if(!activationDate)return setError('Select the activation date');
    if(expiry && expiry<activationDate)return setError('Expiry must be on or after activation date');
    if(editor==='import'){
      const selectedCourse=catalog.courses.find(c=>c.id===courseId);
      if(!selectedCourse||!csvRows.length||csvErrors.length)return setError('Upload a valid student CSV first.');
      if(csvRows.some(row=>![selectedCourse.name.toLowerCase(),selectedCourse.code.toLowerCase()].includes((row.course??'').toLowerCase())))return setError('All CSV rows must match the selected course. Split files by course.');
      void run(async()=>{const result=await subscribersClient.importStudents({courseId,programmeId:chosen.id,subjectIds:subjects,planIds:plans,activeFrom:new Date(`${activationDate}T00:00:00+05:30`).toISOString(),validUntil:expiry?new Date(`${expiry}T23:59:59.999+05:30`).toISOString():null,rows:csvRows,replaceExisting:replaceCsvAccess});setNotice(`${result.created} added, ${result.updated} updated · ${result.grantsAdded} new grants; ${result.grantsUpdated} existing grants updated${replaceCsvAccess?' · previous subscriptions replaced':''}.`);});
    } else if(editor==='create') {
      if(studentName.trim().length<2||!/^\S+@\S+\.\S+$/.test(studentEmail.trim())) return setError('Enter a student name and valid email address');
      if(studentPhone.trim()&&!/^\+?[0-9 ()-]{7,20}$/.test(studentPhone.trim()))return setError('Enter a valid phone number');
      void run(async()=>{await subscribersClient.create({displayName:studentName.trim(),email:studentEmail.trim().toLowerCase(),...(studentPhone.trim()?{phone:studentPhone.trim()}:{}),grants});setNotice('Student saved with assigned subscriptions.');});
    } else if(editor==='single'&&target) {
      const nextGrants=nextSubscriberGrants(target.grants,grants,accessMode,chosen.id);
      void run(async()=>{await subscribersClient.save(target,nextGrants);setNotice(accessMode==='replace'?'Student access replaced. Old programme materials have been revoked.':'Selected programme updated; other subscriptions remain active.');});
    } else if(editor==='bulk') {
      void run(async()=>{await subscribersClient.bulkAssign(selected,grants);setNotice('Plans and subjects assigned to selected subscribers');});
    }
  };
  const revoke=()=>{
    if(!target||!chosen) return;
    if(!window.confirm('Revoke access to this programme for the selected subscriber?')) return;
    void run(async()=>{await subscribersClient.save(target,target.grants.filter(g=>g.programmeId!==chosen.id));setNotice('Programme access revoked');});
  };
  const goPage=(next:string|null,back=false)=>{
    if(!back)setHistory(v=>[...v,currentCursor]);else setHistory(v=>v.slice(0,-1));
    setCurrentCursor(next);setSelected([]);void load(next);
  };

  return <section className="subscriber-workspace" aria-label="Subscribers">
    <div className="a-titlebar"><div><h1>Subscribers</h1><p>Student subscriptions, programme access and automatic expiry.</p></div>
      <div className="a-actions"><button className="a-btn" onClick={()=>void load(currentCursor)} disabled={loading}><RefreshCw size={16}/> Refresh</button>
        <button className="a-btn" onClick={openImport}><FileSpreadsheet size={16}/> Bulk upload</button><button className="a-btn primary" onClick={openCreate}><Plus size={16}/> Add student</button></div>
    </div>
    {error&&!editor&&<div className="subscriber-notice subscriber-error" role="alert"><AlertCircle size={16}/>{error}<button onClick={()=>void load(currentCursor)}>Retry</button></div>}
    {notice&&<div className="subscriber-notice subscriber-success" role="status"><Check size={17}/>{notice}</div>}
    <div className="a-bar subscriber-filters"><label>Course<select value={courseFilter} onChange={e=>{setCourseFilter(e.target.value);setPlanFilter('')}}><option value="">All courses</option>{catalog.courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Plan<select value={planFilter} onChange={e=>setPlanFilter(e.target.value)}><option value="">All plans</option>{listPlans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="a-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search student name or email"/></label>
    </div>
    <section className="a-panel"><div className="a-table-wrap"><table><thead><tr>
      <th><input aria-label="Select subscribers on this page" type="checkbox" checked={rows.length>0&&rows.every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?rows.map(r=>r.id):[])}/></th>
      <th>Student</th><th>Course / programme</th><th>Subscribed plans</th><th>Activated</th><th>Expiry</th><th>Access</th><th>Action</th>
    </tr></thead><tbody>{rows.map(user=>{
      const active=user.grants.filter(valid);
      const named=unique(active.map(g=>catalog.plans.find(p=>p.id===g.planId)?.name??'Unknown plan'));
      const paths=unique(active.map(g=>`${catalog.courses.find(c=>c.id===g.courseId)?.name??'Course'} / ${catalog.programmes.find(p=>p.id===g.programmeId)?.name??'Programme'}`));
      return <tr key={user.id}><td><input aria-label={`Select ${user.email||user.id}`} type="checkbox" checked={selected.includes(user.id)} onChange={e=>setSelected(v=>e.target.checked?[...v,user.id]:v.filter(id=>id!==user.id))}/></td>
        <td><span className="subscriber-person"><span className="a-avatar"><Users size={18}/></span><span><strong>{user.displayName||user.email||'Student'}</strong><small>{user.email||'No email provided'}{user.phone?` · ${user.phone}`:''}</small></span></span></td>
        <td>{paths.join(' · ')||'Not assigned'}</td><td>{named.join(', ')||'—'}</td>
        <td>{user.grants.length?activationDay([...user.grants].sort((a,b)=>(a.activeFrom??'').localeCompare(b.activeFrom??''))[0]?.activeFrom??null)||'—':'—'}</td>
        <td>{user.grants.length?(user.grants.some(g=>!g.validUntil)?'No expiry':day([...user.grants].sort((a,b)=>(b.validUntil??'').localeCompare(a.validUntil??''))[0]?.validUntil??null)):'—'}</td>
        <td><span className={`a-tag ${user.status==='ACTIVE'?'green':user.status==='EXPIRED'||user.status==='LOCKED'?'red':''}`}>{user.status==='ACTIVE'?'Active':user.status==='SCHEDULED'?'Scheduled':user.status==='EXPIRED'?'Expired · Locked':user.status==='LOCKED'?'Locked':'Not active'}</span></td>
        <td><button className="a-btn" onClick={()=>openGrant('single',user)}>Edit access</button></td>
      </tr>;
    })}</tbody></table>
      {!loading&&!rows.length&&<div className="subscriber-empty"><ShieldCheck size={22}/><strong>No matching subscribers</strong><p>Use Add student to register a learner and assign subscribed plans in one step.</p></div>}
      {loading&&<div className="subscriber-empty" role="status">Loading authorized subscribers…</div>}
    </div><div className="a-table-footer"><span>{total} subscribers · {selected.length} selected</span><div className="a-actions">
      {selected.length>0&&<button className="a-btn" onClick={()=>openGrant('bulk',null)}>Assign selected</button>}
      <button className="a-btn" onClick={()=>goPage(history.at(-1)??null,true)} disabled={!history.length||loading}><ArrowLeft size={15}/> Previous</button>
      <button className="a-btn" onClick={()=>goPage(cursor)} disabled={!cursor||loading}>Next <ArrowRight size={15}/></button>
    </div></div></section>
    {editor&&<div className="a-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEditor(null)}}><div className={`a-modal subscriber-dialog ${editor==='import'?'subscriber-import-dialog':''}`} role="dialog" aria-modal="true" aria-label={editor==='create'?'Add student':editor==='import'?'Bulk student upload':'Edit subscriber access'}>
      <button className="a-modal-x" aria-label="Close" disabled={busy} onClick={()=>setEditor(null)}><X size={20}/></button>
      <h2>{editor==='create'?'Add student':editor==='import'?'Bulk student upload':editor==='bulk'?`Assign access to ${selected.length} subscribers`:'Subscriber permissions'}</h2>
      {editor==='import'&&<><p>Import students from CSV with optional per-student Activation Date and Expiry Date (YYYY-MM-DD). Blank dates use the defaults chosen below. Choose the approved course, programme, subjects and multiple plans.</p>
        <div className="a-actions"><button className="a-btn" type="button" onClick={downloadTemplate}><Download size={15}/> Download CSV template</button><label className="a-btn">Choose CSV<input type="file" accept=".csv,text/csv" style={{display:'none'}} onChange={e=>void readCsv(e.target.files?.[0]??null)}/></label>{csvName&&<span>{csvName}</span>}</div>
        {csvRows.length>0&&<><p className="subscriber-import-help">{csvRows.length} students detected · First five shown for review</p><div className="subscriber-import-preview"><table><thead><tr><th>Student name</th><th>Email</th><th>Phone</th><th>Course</th><th>Activation Date</th><th>Expiry Date</th></tr></thead><tbody>{csvRows.slice(0,5).map((row,index)=><tr key={index}><td>{row.name}</td><td>{row.email}</td><td>{row.phone}</td><td>{row.course}</td><td>{row.activationDate||activationDate}</td><td>{row.expiryDate||expiry||'No expiry'}</td></tr>)}</tbody></table></div></>}
        <label className="subscriber-hint"><input type="checkbox" checked={replaceCsvAccess} onChange={e=>setReplaceCsvAccess(e.target.checked)}/> Replace all existing course/programme subscriptions for matched students in this import. Unchecked: add or update matching grants only.</label>
        {replaceCsvAccess&&<p className="subscriber-import-error" role="status">Existing subscriptions for matched students will be revoked and replaced by this import. Other students are unaffected.</p>}
        {!!csvErrors.length&&<p className="subscriber-import-error" role="alert">{csvErrors.slice(0,8).join(' · ')}</p>}
      </>}
      {editor==='create'?<><p>Enter the student's details and choose their subscribed course, programme and plans. Account activation uses the student's registered email. Access is limited to valid subscribed plans.</p>
        <div className="a-form-row"><label>Student name<input autoComplete="name" maxLength={120} value={studentName} onChange={e=>setStudentName(e.target.value)} placeholder="Full name"/></label>
          <label>Email address<input type="email" autoComplete="email" maxLength={254} value={studentEmail} onChange={e=>setStudentEmail(e.target.value)} placeholder="student@example.com"/></label></div>
        <label>Phone number (optional)<input type="tel" autoComplete="tel" maxLength={20} value={studentPhone} onChange={e=>setStudentPhone(e.target.value)} placeholder="+91 9999999999"/></label>
      </>:target?<p><strong>{target.displayName||target.email||'Student'}</strong> · {target.email||'Student'}</p>:null}
        <p>Access is issued only for the selected course, approved programme, mapped subjects and subscribed plans.</p>
        <div className="a-form-row"><label>Course<select value={courseId} onChange={e=>onCourse(e.target.value)}><option value="">Select course</option>{catalog.courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Programme<select value={programmeId} onChange={e=>chooseProgramme(e.target.value)}><option value="">Select locked programme</option>{programmes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
        {!chosen&&<p className="subscriber-hint">Create and lock a programme in Academic Mapping before assigning access.</p>}
        {chosen&&<><h3>Subjects</h3><div className="a-check-grid">{mappedSubjects.map(s=><label key={s.id} className="a-check"><input type="checkbox" checked={subjects.includes(s.id)} onChange={()=>toggle(s.id,subjects,setSubjects)}/>{s.name}</label>)}</div>
          <h3>Subscription plans</h3><div className="a-check-grid">{mappedPlans.map(p=><label key={p.id} className="a-check"><input type="checkbox" checked={plans.includes(p.id)} onChange={()=>toggle(p.id,plans,setPlans)}/>{p.name}</label>)}</div>
          <div className="a-form-row"><label>Activated date<input type="date" value={activationDate} onChange={e=>setActivationDate(e.target.value)}/></label>
          <label>Expiry date (optional)<input type="date" value={expiry} min={activationDate} onChange={e=>setExpiry(e.target.value)}/></label></div>
          <p className="subscriber-hint">{editor==='import'?'Dates here are defaults; each CSV row can override them. ':''}Access automatically starts on the activation date and locks after expiry.</p>
          {editor==='single'&&target&&<div className="subscriber-access-mode" role="group" aria-label="How to apply this student's access change">
            <label className="a-check"><input type="radio" name="subscriber-access-mode" checked={accessMode==='replace'} onChange={()=>setAccessMode('replace')}/> Replace existing access — remove previous course, programme, subject and plan grants</label>
            <label className="a-check"><input type="radio" name="subscriber-access-mode" checked={accessMode==='keep-other-programmes'} onChange={()=>setAccessMode('keep-other-programmes')}/> Keep other programmes — only replace grants for the selected programme</label>
            <p className="subscriber-hint">{accessMode==='replace'?`${target.grants.length} current grants will be replaced by ${plans.length*subjects.length} selected grants. Old materials will no longer be accessible.`:'Other course and programme access is retained intentionally.'}</p>
          </div>}
          <p className="subscriber-hint">{plans.length} plans × {subjects.length} subjects = {plans.length*subjects.length} selected access grants.</p>
        </>}
        <div className="a-actions"><button className="a-btn" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button>
          {editor==='single'&&target&&chosen&&target.grants.some(g=>g.programmeId===chosen.id)&&<button className="a-btn" disabled={busy} onClick={revoke}>Revoke programme</button>}
          <button className="a-btn primary" disabled={busy||!chosen||!subjects.length||!plans.length||(editor==='create'&&(!studentName.trim()||!studentEmail.trim()))||(editor==='import'&&(!csvRows.length||!!csvErrors.length))} onClick={save}>{busy?'Saving…':editor==='create'?'Add student':editor==='import'?`Import ${csvRows.length} students`:editor==='bulk'?'Assign to selected':accessMode==='replace'?'Replace access':'Save permissions'}</button></div>
      {error&&<div className="subscriber-notice subscriber-error" role="alert"><AlertCircle size={16}/>{error}</div>}
    </div></div>}
  </section>;
}
