import {useEffect,useState,type ReactNode} from 'react';
import {StartLauncher,QuickLauncher,type AdminView} from './StartLauncher';
import {LayoutDashboard,BookOpen,FolderOpen,CalendarDays,Users,Settings2,Search,Plus,Lock,Unlock,Check,ChevronRight,ChevronDown,FileText,Pin,Upload,GraduationCap,ShieldCheck,UserRound,Clock,CheckCircle2,CalendarClock,Filter,Image as ImageIcon,Bell,Menu,ArrowLeft,ArrowRight,BarChart3,Save, X, Mail, Pencil, SlidersHorizontal, ClipboardCheck, Eye, FileSpreadsheet,Grid2X2} from 'lucide-react';
import './admin.css';
import './academic.css';
import { UploadsWorkspace } from './UploadsWorkspace';
import { AcademicTaxonomyManager } from './AcademicTaxonomyManager';
import { SessionsWorkspace } from './SessionsWorkspace';
import {sessionsClient,type LiveSession} from './sessions-client';
import { SubscribersWorkspace } from './SubscribersWorkspace';
import { subscribersClient, type SubscriberSummary } from './subscribers-client';
import { academicClient, type AcademicCatalog, type AcademicKind, type AcademicManageKind, type AcademicProgramme } from './academic-client';
type View=AdminView;
type Employee={id:string;name:string;email:string;modules:View[];active:boolean};
const icons={Analytics:BarChart3,'Academic Mapping':BookOpen,Uploads:FolderOpen,Sessions:CalendarDays,Subscribers:Users,Employees:ShieldCheck};
const allViews:View[]=['Analytics','Academic Mapping','Uploads','Sessions','Subscribers','Employees'];
const fmt=(s:string)=>new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
const uid=()=>Math.random().toString(36).slice(2,10);
function B({children,onClick,primary=false,disabled=false}: {children:ReactNode;onClick:()=>void;primary?:boolean;disabled?:boolean}){return <button disabled={disabled} className={'a-btn '+(primary?'primary':'')} onClick={onClick}>{children}</button>}
function Cbox({value,checked,onChange,disabled=false}:{value:string;checked:boolean;onChange:(x:boolean)=>void;disabled?:boolean}){return <label className="a-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span>{value}</span></label>}
function Tag({text}:{text:string}){return <span className={'a-tag '+(/Completed|Active|Published/.test(text)?'green':/Upcoming|Today/.test(text)?'blue':/Cancelled|Expired|Failed/.test(text)?'red':'')}>{text}</span>}
export default function AdminWorkspace({onStudent,allowStudentSwitch=false}:{onStudent:()=>void;allowStudentSwitch?:boolean}){
const[manageAcademic,setManageAcademic]=useState(false);const[academicManageTarget,setAcademicManageTarget]=useState<{kind:AcademicManageKind;id:string}|null>(null);const[view,setView]=useState<View|'Start'>('Start');const[menu,setMenu]=useState(false);const[launcherSearch,setLauncherSearch]=useState('');const[recentViews,setRecentViews]=useState<View[]>([]);const[showSwitcher,setShowSwitcher]=useState(false);const[query,setQuery]=useState('');const[courseItems,setCourseItems]=useState<AcademicCatalog['courses']>([]);const[planItems,setPlanItems]=useState<AcademicCatalog['plans']>([]);const[subjectItems,setSubjectItems]=useState<AcademicCatalog['subjects']>([]);const[programmeItems,setProgrammeItems]=useState<AcademicProgramme[]>([]);const[uploadCount,setUploadCount]=useState<number|null>(null);const[publishedCount,setPublishedCount]=useState<number|null>(null);const[subscriberSummary,setSubscriberSummary]=useState<SubscriberSummary|null>(null);const[sessionCount,setSessionCount]=useState<number|null>(null);const[upcomingSessions,setUpcomingSessions]=useState<LiveSession[]>([]);const[employees,setEmployees]=useState<Employee[]>([{id:'e1',name:'Content Manager',email:'content@example.com',modules:['Uploads','Sessions'],active:true}]);const[course,setCourse]=useState('');const[programme,setProgramme]=useState('');const[modal,setModal]=useState('');const[newName,setNewName]=useState('');const[editor,setEditor]=useState<string|null>(null);const[notice,setNotice]=useState('');const[employeeDraft,setEmployeeDraft]=useState<Employee|null>(null);
useEffect(()=>{void subscribersClient.summary().then(setSubscriberSummary).catch(()=>{});void sessionsClient.summary().then(v=>setSessionCount(v.total)).catch(()=>{});void sessionsClient.adminList({tab:'Upcoming'}).then(v=>setUpcomingSessions(v.items.slice(0,6))).catch(()=>{});},[]);
const flash=(x:string)=>{setNotice(x);setTimeout(()=>setNotice(''),4000)};
const[academicCatalog,setAcademicCatalog]=useState<AcademicCatalog>({courses:[],plans:[],subjects:[],programmes:[]});
const[academicBusy,setAcademicBusy]=useState(false);
const[academicLoading,setAcademicLoading]=useState(true);
const[academicError,setAcademicError]=useState('');
const refreshAcademic=async (preferCourse?:string,preferProgramme?:string) => {
  const data:AcademicCatalog=await academicClient.getCatalog();
  setAcademicCatalog(data);
  setCourseItems(data.courses);
  setPlanItems(data.plans);
  setSubjectItems(data.subjects);
  setProgrammeItems(data.programmes);
  const activeCourse = preferCourse && data.courses.some(c=>c.id===preferCourse) ? preferCourse
    : data.courses.some(c=>c.id===course) ? course : (data.courses[0]?.id ?? '');
  setCourse(activeCourse);
  const inCourse = data.programmes.filter(g=>g.courseId===activeCourse);
  const activeProgramme = preferProgramme && inCourse.some(g=>g.id===preferProgramme) ? preferProgramme
    : inCourse.some(g=>g.id===programme) ? programme : (inCourse[0]?.id ?? '');
  setProgramme(activeProgramme);
};
useEffect(()=>{void refreshAcademic().catch(e=>setAcademicError(e instanceof Error?e.message:'Unable to load academic data')).finally(()=>setAcademicLoading(false));},[]);

const scopedPlans=planItems.filter(p=>p.courseId===course);
const scopedProgrammes=programmeItems.filter(p=>p.courseId===course);
const selectedProgramme=programmeItems.find(p=>p.id===programme&&p.courseId===course);
const filtered=(s:string)=>s.toLowerCase().includes(query.toLowerCase());
const addEntity=async (kind:string)=>{
  if (academicBusy || academicLoading) return;
  if (!newName.trim()) return flash('Enter a name first');
  if ((kind==='Plan'||kind==='Programme')&&!course) return flash('Create or select a course first');
  setAcademicBusy(true);setAcademicError('');
  try {
    const result=await academicClient.create(kind as AcademicKind,newName.trim(),course);
    await refreshAcademic(kind==='Course'?result.id:course,kind==='Programme'?result.id:undefined);
    setModal('');setNewName('');flash(kind+' saved');
  } catch(e){setAcademicError(e instanceof Error?e.message:'Unable to create academic record');}
  finally{setAcademicBusy(false);}
};
const toggleMapping=async (field:'planIds'|'subjectIds',value:string)=>{
  if (!selectedProgramme || academicBusy) return;
  if (selectedProgramme.locked) return flash('Unlock this programme before changing mapping');
  const planIds=field==='planIds' ? (selectedProgramme.planIds.includes(value)?selectedProgramme.planIds.filter(x=>x!==value):[...selectedProgramme.planIds,value]):selectedProgramme.planIds;
  const subjectIds=field==='subjectIds' ? (selectedProgramme.subjectIds.includes(value)?selectedProgramme.subjectIds.filter(x=>x!==value):[...selectedProgramme.subjectIds,value]):selectedProgramme.subjectIds;
  setAcademicBusy(true);setAcademicError('');
  try {await academicClient.saveMapping(selectedProgramme.id,selectedProgramme.revision,planIds,subjectIds);await refreshAcademic(course,selectedProgramme.id);}
  catch(e){setAcademicError(e instanceof Error?e.message:'Unable to save mapping');await refreshAcademic(course,selectedProgramme.id).catch(()=>{});}
  finally{setAcademicBusy(false);}
};
const toggleLock=async()=>{
  if (!selectedProgramme||academicBusy) return;
  setAcademicBusy(true);setAcademicError('');
  try {
    await academicClient.lockMapping(selectedProgramme.id,selectedProgramme.revision,!selectedProgramme.locked);
    await refreshAcademic(course,selectedProgramme.id);
    flash(selectedProgramme.locked?'Mapping unlocked':'Mapping locked');
  } catch(e){setAcademicError(e instanceof Error?e.message:'Unable to change mapping lock');await refreshAcademic(course,selectedProgramme.id).catch(()=>{});}
  finally{setAcademicBusy(false);}
};
const go=(next:View)=>{setView(next);setQuery('');setMenu(false);setShowSwitcher(false);setLauncherSearch('');setRecentViews(r=>[next,...r.filter(v=>v!==next)].slice(0,4))};
useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setShowSwitcher(true);setLauncherSearch('')}else if(event.key==='Escape'){setShowSwitcher(false)}else if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();setView('Start');setShowSwitcher(false)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
const appCounts:Partial<Record<View,string>>={Analytics:subscriberSummary===null?'—':String(subscriberSummary.active), 'Academic Mapping':String(programmeItems.length),Uploads:uploadCount===null?'—':String(uploadCount),Sessions:sessionCount===null?'—':String(sessionCount),Subscribers:subscriberSummary===null?'—':String(subscriberSummary.total),Employees:String(employees.length)};
const header=(title:string,desc:string,action?:ReactNode)=><div className="a-titlebar"><div><h1>{title}</h1><p>{desc}</p></div>{action}</div>;
const nav=(<div className="a-dashboard-nav">{allViews.map(v=>{const Icon=icons[v];return <button key={v} className={view===v?'chosen':''} onClick={()=>{setView(v);setQuery('')}}><Icon size={22} strokeWidth={1.8}/><span>{v==='Academic Mapping'?'Mapping':v}</span></button>})}<button onClick={onStudent}><GraduationCap size={22}/><span>Student preview</span></button></div>);
const analytics=(<>{header('Analytics','A compact overview of access, content, and learning activity.')}<div className="a-stat-grid">{[{icon:Users,label:'Active subscribers',value:subscriberSummary?.active??'—'},{icon:BookOpen,label:'Courses / plans',value:courseItems.length+' / '+planItems.length},{icon:GraduationCap,label:'Programmes',value:programmeItems.length},{icon:FileText,label:'Published files',value:publishedCount??'—'},{icon:CalendarDays,label:'Sessions',value:sessionCount??'—'},{icon:ShieldCheck,label:'Employee profiles',value:employees.length}].map(x=><div className="a-stat" key={x.label}><x.icon size={20}/><span>{x.label}</span><strong>{x.value}</strong></div>)}</div><div className="a-two"><section className="a-panel"><h2>Course performance</h2><table><thead><tr><th>Course</th><th>Plans</th><th>Subscribers</th><th>Programmes</th></tr></thead><tbody>{courseItems.map(c=><tr key={c.id}><td>{c.name}</td><td>{planItems.filter(p=>p.courseId===c.id).length}</td><td>{(subscriberSummary?.byCourse[c.id]??'—')}</td><td>{programmeItems.filter(p=>p.courseId===c.id).length}</td></tr>)}</tbody></table></section><section className="a-panel"><h2>Upcoming sessions</h2>{upcomingSessions.filter(s=>s.status==='SCHEDULED'||s.status==='POSTPONED').map(s=><div className="a-activity" key={s.id}><CalendarClock size={18}/><div><strong>{s.topic}</strong><small>{new Date(s.startAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} · {s.facultyName}</small></div><Tag text={s.status}/></div>)}</section></div></>);
const mapping=(<>
  {header('Academic Mapping','Create once, connect with ticks, and lock approved mappings.',<div className="a-actions">{(['Course','Plan','Programme','Subject'] as const).map(k=><B key={k} disabled={academicBusy||academicLoading} onClick={()=>{setAcademicError('');setModal(k);setNewName('')}}><Plus size={15}/> {k}</B>)}<B disabled={academicLoading} onClick={()=>{setAcademicManageTarget(null);setManageAcademic(v=>!v)}}><Pencil size={15}/> Manage records</B></div>)}
  {academicLoading&&<p role="status" className="a-mapping-feedback">Loading academic mappings…</p>}
  {academicError&&<p role="alert" className="a-mapping-feedback a-mapping-error">{academicError} <button type="button" onClick={()=>{setAcademicError('');void refreshAcademic().catch(e=>setAcademicError(e instanceof Error?e.message:'Unable to reload data'))}}>Reload</button></p>}
  {!academicLoading&&!courseItems.length&&<p className="a-mapping-feedback">No academic records yet. Use + Course to create the first course. Prototype data is not imported automatically.</p>}
  <div className="a-bar"><label>Course <select value={course} disabled={academicBusy} onChange={e=>{setCourse(e.target.value);const g=programmeItems.find(p=>p.courseId===e.target.value);setProgramme(g?.id||'')}}><option value="">Select course</option>{courseItems.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="a-search"><Search size={16}/><input placeholder="Find programmes..." value={query} onChange={e=>setQuery(e.target.value)}/></label>{course&&<button type="button" className="a-btn academic-inline-options" onClick={()=>{setManageAcademic(true);setAcademicManageTarget({kind:'courses',id:course})}} aria-label="Manage selected course"><Pencil size={15}/> Course options</button>}</div>
  <div className="a-mapping-grid"><section className="a-panel"><h2>Programmes</h2>{scopedProgrammes.filter(p=>filtered(p.name)).map(p=><button key={p.id} className={'a-programme '+(p.id===programme?'selected':'')} onClick={()=>setProgramme(p.id)}><BookOpen size={18}/><span><strong>{p.name}</strong><small>{p.planIds.length} plans · {p.subjectIds.length} subjects</small></span>{p.locked?<Lock size={15}/>:<ChevronRight size={16}/>}</button>)}{!scopedProgrammes.length&&<p>No programmes in this course yet.</p>}</section>
  <section className="a-panel mapping-editor"><div className="a-panel-title"><div><h2>{selectedProgramme?.name||'Select programme'}</h2><p>Tick the plans and subjects that belong to this programme.</p></div><div className="a-actions">{selectedProgramme&&<button type="button" className="a-btn academic-inline-options" aria-label={`Manage ${selectedProgramme.name}`} onClick={()=>{setManageAcademic(true);setAcademicManageTarget({kind:'programmes',id:selectedProgramme.id})}}><Pencil size={15}/> Programme options</button>}<B disabled={!selectedProgramme||academicBusy} onClick={()=>void toggleLock()}>{selectedProgramme?.locked?<Unlock size={15}/>:<Lock size={15}/>} {selectedProgramme?.locked?'Unlock':'Lock mapping'}</B></div></div>{selectedProgramme&&<div className="a-map-columns"><div><h3>Subscription plans</h3>{scopedPlans.map(p=><Cbox key={p.id} value={p.name} checked={selectedProgramme.planIds.includes(p.id)} disabled={academicBusy||selectedProgramme.locked} onChange={()=>void toggleMapping('planIds',p.id)}/>)}</div><div><h3>Subjects</h3><div className="a-check-grid">{subjectItems.map(s=><Cbox key={s.id} value={s.name} checked={selectedProgramme.subjectIds.includes(s.id)} disabled={academicBusy||selectedProgramme.locked} onChange={()=>void toggleMapping('subjectIds',s.id)}/>)}</div></div></div>}</section></div>
  <>{manageAcademic&&<AcademicTaxonomyManager catalog={academicCatalog} selection={academicManageTarget} onEditClosed={()=>setAcademicManageTarget(null)} onRefresh={async()=>{await refreshAcademic(course,programme)}}/>}</>
</>);
const uploads=(<UploadsWorkspace courses={courseItems} plans={planItems} subjects={subjectItems} programmes={programmeItems} onCounts={(total,published)=>{setUploadCount(total);setPublishedCount(published)}} onOpenAcademicMapping={()=>{go('Academic Mapping');void refreshAcademic().catch(e=>setAcademicError(e instanceof Error?e.message:'Unable to reload academic data'))}}/>);
const sessionsView=(<SessionsWorkspace onCount={setSessionCount}/>);
const subscribers=(<SubscribersWorkspace onCounts={(total,active,byCourse)=>setSubscriberSummary(s=>s?.total===total&&s.active===active&&JSON.stringify(s.byCourse)===JSON.stringify(byCourse)?s:{total,active,byCourse})}/>);
const employeesScreen=(<>{header('Employee access','Create internal profiles and select which modules they can access.',<B primary onClick={()=>{setEmployeeDraft({id:uid(),name:'',email:'',modules:[],active:true});setModal('Employee')}}><Plus size={16}/> Employee</B>)}<section className="a-panel"><table><thead><tr><th>Employee</th><th>Visible modules</th><th>Status</th><th></th></tr></thead><tbody>{employees.map(e=><tr key={e.id}><td><strong>{e.name}</strong><small>{e.email}</small></td><td>{e.modules.join(' · ')||'No modules assigned'}</td><td><Tag text={e.active?'Active':'Disabled'}/></td><td><B onClick={()=>{setEmployeeDraft({...e});setModal('Employee')}}>Edit access</B></td></tr>)}</tbody></table></section></>);
const modalContent=()=>{if(['Course','Plan','Subject','Programme'].includes(modal))return <><h2>Add {modal}</h2>{academicError&&<p className="a-mapping-feedback a-mapping-error" role="alert">{academicError}</p>}<label>Name<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} placeholder={modal+' name'}/></label><div className="a-actions"><B onClick={()=>setModal('')}>Cancel</B><B primary disabled={academicBusy} onClick={()=>void addEntity(modal)}>Create</B></div></>;
if(modal==='Employee'&&employeeDraft){const e=employeeDraft;return <><h2>Employee permissions</h2><label>Name<input value={e.name} onChange={v=>setEmployeeDraft({...e,name:v.target.value})}/></label><label>Email<input value={e.email} onChange={v=>setEmployeeDraft({...e,email:v.target.value})}/></label><h3>Module visibility and access</h3><div className="a-check-grid">{allViews.map(v=><Cbox key={v} value={v} checked={e.modules.includes(v)} onChange={checked=>setEmployeeDraft({...e,modules:checked?[...e.modules,v]:e.modules.filter(x=>x!==v)})}/>)}</div><div className="a-actions"><B onClick={()=>setModal('')}>Cancel</B><B primary onClick={()=>{if(!e.name||!e.email.includes('@'))return flash('Enter name and valid email');setEmployees(a=>[...a.filter(x=>x.id!==e.id),e]);setModal('');flash('Employee access saved in prototype')}}>Save access</B></div></>}

return null;};
return <div className="a-app a-v18">
  <header className="a-top">
    <div className="a-top-brand-and-nav">
      <button className="a-top-start" onClick={()=>{setView('Start');setShowSwitcher(false);setLauncherSearch('')}} aria-label="Go to workspace launcher" title="Start · Home"><Grid2X2 size={20}/></button>
      <div className="a-brand"><img src="/doctutorials-mark.png" alt="DocTutorials"/><strong>DocHub</strong><span>by DocTutorials</span></div>
      <div className="a-top-trail"><ChevronRight size={13}/><button onClick={()=>setView('Start')}>Workspace</button>{view!=='Start'&&<><ChevronRight size={13}/><strong>{view}</strong></>}</div>
    </div>
    <div className="a-top-right">
      <button className="a-apps-button" aria-expanded={showSwitcher} onClick={()=>{setShowSwitcher(x=>!x);setLauncherSearch('')}} title="Open apps · ⌘K"><Grid2X2 size={16}/><span>All apps</span><ChevronDown size={14}/></button>
      {allowStudentSwitch&&<button className="a-quiet" onClick={onStudent}><Eye size={16}/> Student workspace</button>}
      <span className="a-avatar"><UserRound size={20}/></span>
    </div>
  </header>
  {showSwitcher&&<><div className="a-launch-shade" onClick={()=>setShowSwitcher(false)}/><QuickLauncher onOpen={go} onStudent={onStudent} allowStudentSwitch={allowStudentSwitch} search={launcherSearch} onSearch={setLauncherSearch}/></>}
  <div className="a-body"><main className="a-main">
    {view==='Start'?<StartLauncher onOpen={go} onStudent={onStudent} allowStudentSwitch={allowStudentSwitch} counts={appCounts} recent={recentViews} search={launcherSearch} onSearch={setLauncherSearch}/>:
      <><div className="a-breadcrumb"><button className="a-icon-button" onClick={()=>setView('Start')} aria-label="Return to apps"><Grid2X2 size={15}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{view}</strong></div>{view==='Analytics'?analytics:view==='Academic Mapping'?mapping:view==='Uploads'?uploads:view==='Sessions'?sessionsView:view==='Subscribers'?subscribers:employeesScreen}</>}
  </main></div>
  {modal&&<div className="a-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)setModal('')}}><div className="a-modal"><button className="a-modal-x" onClick={()=>setModal('')} aria-label="Close"><X/></button>{modalContent()}</div></div>}
  {notice&&<div className="a-toast"><Check size={16}/>{notice}</div>}
</div>}
