import {WorkspaceHeader,WorkspaceAccount,useCanManage} from './WorkspaceHeader';
import {WorkspaceAnalytics,EmployeeWorkspace,WatermarkWorkspace} from './WorkspaceOperations';
import {NotificationsWorkspace} from './NotificationsWorkspace';
import {useContext,useEffect,useState,type ReactNode} from 'react';
import {StartLauncher,type AdminView} from './StartLauncher';
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
const icons={Analytics:BarChart3,'Academic Mapping':BookOpen,Uploads:FolderOpen,Sessions:CalendarDays,Subscribers:Users,Employees:ShieldCheck,Notifications:Bell,Watermark:ShieldCheck};
const workspaceViews:View[]=['Analytics','Academic Mapping','Uploads','Sessions','Subscribers','Notifications','Watermark','Employees'];
const fmt=(s:string)=>new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
const uid=()=>Math.random().toString(36).slice(2,10);
function B({children,onClick,primary=false,disabled=false}: {children:ReactNode;onClick:()=>void;primary?:boolean;disabled?:boolean}){return <button disabled={disabled} className={'a-btn '+(primary?'primary':'')} onClick={onClick}>{children}</button>}
function Cbox({value,checked,onChange,disabled=false}:{value:string;checked:boolean;onChange:(x:boolean)=>void;disabled?:boolean}){return <label className="a-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span>{value}</span></label>}
function Tag({text}:{text:string}){return <span className={'a-tag '+(/Completed|Active|Published/.test(text)?'green':/Upcoming|Today/.test(text)?'blue':/Cancelled|Expired|Failed/.test(text)?'red':'')}>{text}</span>}
export default function AdminWorkspace({onStudent,allowStudentSwitch=false}:{onStudent:()=>void;allowStudentSwitch?:boolean}){
const auth=useContext(WorkspaceAccount),canManageMapping=useCanManage('Academic Mapping');const allViews=workspaceViews.filter(v=>!auth||auth.account.roles.includes('SUPER_ADMIN')||(auth.account.employee?auth.account.modulePermissions?.some(p=>p.module===v&&p.canView):['Analytics','Academic Mapping','Uploads','Sessions','Notifications'].includes(v)));
const[manageAcademic,setManageAcademic]=useState(false);const[academicManageTarget,setAcademicManageTarget]=useState<{kind:AcademicManageKind;id:string}|null>(null);const[view,setView]=useState<View|'Start'>('Start');const[menu,setMenu]=useState(false);const[launcherSearch,setLauncherSearch]=useState('');const[recentViews,setRecentViews]=useState<View[]>([]);const[showSwitcher,setShowSwitcher]=useState(false);const[query,setQuery]=useState('');const[courseItems,setCourseItems]=useState<AcademicCatalog['courses']>([]);const[planItems,setPlanItems]=useState<AcademicCatalog['plans']>([]);const[subjectItems,setSubjectItems]=useState<AcademicCatalog['subjects']>([]);const[programmeItems,setProgrammeItems]=useState<AcademicProgramme[]>([]);const[uploadCount,setUploadCount]=useState<number|null>(null);const[publishedCount,setPublishedCount]=useState<number|null>(null);const[subscriberSummary,setSubscriberSummary]=useState<SubscriberSummary|null>(null);const[sessionCount,setSessionCount]=useState<number|null>(null);const[upcomingSessions,setUpcomingSessions]=useState<LiveSession[]>([]);const[course,setCourse]=useState('');const[programme,setProgramme]=useState('');const[modal,setModal]=useState('');const[newName,setNewName]=useState('');const[editor,setEditor]=useState<string|null>(null);const[notice,setNotice]=useState('');
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
useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();document.querySelector<HTMLInputElement>('input[aria-label="Search DocHub"]')?.focus()}else if(event.key==='Escape'){setShowSwitcher(false)}else if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();setView('Start');setShowSwitcher(false)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
const appCounts:Partial<Record<View,string>>={Analytics:subscriberSummary===null?'—':String(subscriberSummary.active), 'Academic Mapping':String(programmeItems.length),Uploads:uploadCount===null?'—':String(uploadCount),Sessions:sessionCount===null?'—':String(sessionCount),Subscribers:subscriberSummary===null?'—':String(subscriberSummary.total),Employees:''};
const header=(title:string,desc:string,action?:ReactNode)=><div className="a-titlebar"><div><h1>{title}</h1><p>{desc}</p></div>{action}</div>;


const mapping=(<>
  {header('Academic Mapping','Create once, connect with ticks, and lock approved mappings.',<div className="a-actions">{(['Course','Plan','Programme','Subject'] as const).map(k=><B key={k} disabled={!canManageMapping||academicBusy||academicLoading} onClick={()=>{setAcademicError('');setModal(k);setNewName('')}}><Plus size={15}/> {k}</B>)}<B disabled={!canManageMapping||academicLoading} onClick={()=>{setAcademicManageTarget(null);setManageAcademic(v=>!v)}}><Pencil size={15}/> Manage records</B></div>)}
  {academicLoading&&<p role="status" className="a-mapping-feedback">Loading academic mappings…</p>}
  {academicError&&<p role="alert" className="a-mapping-feedback a-mapping-error">{academicError} <button type="button" onClick={()=>{setAcademicError('');void refreshAcademic().catch(e=>setAcademicError(e instanceof Error?e.message:'Unable to reload data'))}}>Reload</button></p>}
  {!academicLoading&&!courseItems.length&&<p className="a-mapping-feedback">No academic records yet. Use + Course to create the first course. Prototype data is not imported automatically.</p>}
  <div className="a-bar"><label>Course <select value={course} disabled={academicBusy} onChange={e=>{setCourse(e.target.value);const g=programmeItems.find(p=>p.courseId===e.target.value);setProgramme(g?.id||'')}}><option value="">Select course</option>{courseItems.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{course&&<button type="button" disabled={!canManageMapping} className="a-btn academic-inline-options" onClick={()=>{setManageAcademic(true);setAcademicManageTarget({kind:'courses',id:course})}} aria-label="Manage selected course"><Pencil size={15}/> Course options</button>}</div>
  <div className="a-mapping-grid"><section className="a-panel"><h2>Programmes</h2>{scopedProgrammes.filter(p=>filtered(p.name)).map(p=><button key={p.id} className={'a-programme '+(p.id===programme?'selected':'')} onClick={()=>setProgramme(p.id)}><BookOpen size={18}/><span><strong>{p.name}</strong><small>{p.planIds.length} plans · {p.subjectIds.length} subjects</small></span>{p.locked?<Lock size={15}/>:<ChevronRight size={16}/>}</button>)}{!scopedProgrammes.length&&<p>No programmes in this course yet.</p>}</section>
  <section className="a-panel mapping-editor"><div className="a-panel-title"><div><h2>{selectedProgramme?.name||'Select programme'}</h2><p>Tick the plans and subjects that belong to this programme.</p></div><div className="a-actions">{selectedProgramme&&<button type="button" disabled={!canManageMapping} className="a-btn academic-inline-options" aria-label={`Manage ${selectedProgramme.name}`} onClick={()=>{setManageAcademic(true);setAcademicManageTarget({kind:'programmes',id:selectedProgramme.id})}}><Pencil size={15}/> Programme options</button>}<B disabled={!canManageMapping||!selectedProgramme||academicBusy} onClick={()=>void toggleLock()}>{selectedProgramme?.locked?<Unlock size={15}/>:<Lock size={15}/>} {selectedProgramme?.locked?'Unlock':'Lock mapping'}</B></div></div>{selectedProgramme&&<div className="a-map-columns"><div><h3>Subscription plans</h3>{scopedPlans.map(p=><Cbox key={p.id} value={p.name} checked={selectedProgramme.planIds.includes(p.id)} disabled={!canManageMapping||academicBusy||selectedProgramme.locked} onChange={()=>void toggleMapping('planIds',p.id)}/>)}</div><div><h3>Subjects</h3><div className="a-check-grid">{subjectItems.map(s=><Cbox key={s.id} value={s.name} checked={selectedProgramme.subjectIds.includes(s.id)} disabled={!canManageMapping||academicBusy||selectedProgramme.locked} onChange={()=>void toggleMapping('subjectIds',s.id)}/>)}</div></div></div>}</section></div>
  <>{manageAcademic&&<AcademicTaxonomyManager catalog={academicCatalog} selection={academicManageTarget} onEditClosed={()=>setAcademicManageTarget(null)} onRefresh={async()=>{await refreshAcademic(course,programme)}}/>}</>
</>);
const uploads=(<UploadsWorkspace courses={courseItems} plans={planItems} subjects={subjectItems} programmes={programmeItems} onCounts={(total,published)=>{setUploadCount(total);setPublishedCount(published)}} onOpenAcademicMapping={()=>{go('Academic Mapping');void refreshAcademic().catch(e=>setAcademicError(e instanceof Error?e.message:'Unable to reload academic data'))}}/>);
const sessionsView=(<SessionsWorkspace onCount={setSessionCount}/>);
const subscribers=(<SubscribersWorkspace onCounts={(total,active,byCourse)=>setSubscriberSummary(s=>s?.total===total&&s.active===active&&JSON.stringify(s.byCourse)===JSON.stringify(byCourse)?s:{total,active,byCourse})}/>);

const modalContent=()=>{if(['Course','Plan','Subject','Programme'].includes(modal))return <><h2>Add {modal}</h2>{academicError&&<p className="a-mapping-feedback a-mapping-error" role="alert">{academicError}</p>}<label>Name<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} placeholder={modal+' name'}/></label><div className="a-actions"><B onClick={()=>setModal('')}>Cancel</B><B primary disabled={academicBusy} onClick={()=>void addEntity(modal)}>Create</B></div></>;


return null;};
return <div className="a-app a-v18">
  <WorkspaceHeader title={view==='Start'?'Home':view} onHome={()=>setView('Start')} onNavigate={module=>go(module as View)} modules={allViews} onNotifications={allViews.includes('Notifications')?()=>go('Notifications'):undefined}/>
  <div className="a-body"><main className="a-main">
    {view==='Start'?<StartLauncher onOpen={go} onStudent={onStudent} allowStudentSwitch={allowStudentSwitch} allowedViews={allViews} counts={appCounts} recent={recentViews} search={launcherSearch} onSearch={setLauncherSearch}/>:
      <><div className="a-breadcrumb"><button className="a-breadcrumb-home" onClick={()=>setView('Start')}>All apps</button><span>Workspace</span><ChevronRight size={13}/><strong>{view}</strong></div>{view==='Analytics'?<WorkspaceAnalytics/>:view==='Academic Mapping'?mapping:view==='Uploads'?uploads:view==='Sessions'?sessionsView:view==='Subscribers'?subscribers:view==='Notifications'?<NotificationsWorkspace admin/>:view==='Watermark'?<WatermarkWorkspace/>:<EmployeeWorkspace/>}</>}
  </main></div>
  {modal&&<div className="a-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)setModal('')}}><div className="a-modal"><button className="a-modal-x" onClick={()=>setModal('')} aria-label="Close"><X/></button>{modalContent()}</div></div>}
  {notice&&<div className="a-toast"><Check size={16}/>{notice}</div>}
</div>}
