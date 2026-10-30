import {useWorkspaceChanges,refreshWorkspaceChanges} from './workspace-changes';
import {useCanManage} from './WorkspaceHeader';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Bell,CalendarDays,Check,ChevronLeft,ChevronRight,Download,Eye,FileText,Inbox,Mail,Paperclip,Plus,RefreshCw,Search,Send,Users,X} from 'lucide-react';
import {academicClient,type AcademicCatalog} from './academic-client';
import {notificationsClient,type NotificationDetail,type NotificationDraft,type NotificationMessage,type NotificationTarget} from './notifications-client';
import {DocumentPreview} from './DocumentPreview';
import './notifications.css';
const when=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const label=(kind:string)=>kind==='CUSTOM'?'Custom':kind==='MATERIAL'?'Material published':'Session published';
const templates=[
 {name:'Announcement',title:'An update for your course',body:'Hello students,\n\nWe have an important update for your course.\n\n[Add your announcement here]\n\nRegards,\nDocTutorials team'},
 {name:'Study reminder',title:'Your next study milestone',body:'Hello students,\n\nA quick reminder to complete your assigned learning materials before [date].\n\n[Add the topics and instructions]\n\nKeep learning,\nDocTutorials team'},
 {name:'Session update',title:'An update to your live session',body:'Hello students,\n\nPlease note the following change to your session:\nTopic: [session topic]\nDate and time: [date and time, IST]\n\n[Add any additional instructions]\n\nDocTutorials team'},
 {name:'Resource shared',title:'New resources for your preparation',body:'Hello students,\n\nWe have shared additional resources for [topic]. Please find the attached files.\n\n[Add study instructions]\n\nDocTutorials team'},
];
function readFile(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(new Error(`Cannot read ${file.name}`));reader.readAsDataURL(file);});}
export function NotificationsWorkspace({admin=false,onUnreadChange,onSession}:{admin?:boolean;onUnreadChange?:()=>void;onSession?:()=>void}){
 const canManage=useCanManage('Notifications');
 const [materialPreview,setMaterialPreview]=useState<{id:string;title:string}|null>(null);
 const [items,setItems]=useState<NotificationMessage[]>([]),[kind,setKind]=useState('ALL'),[query,setQuery]=useState(''),[unread,setUnread]=useState(false);
 const [page,setPage]=useState(1),[nextPage,setNextPage]=useState<number|null>(null),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [detail,setDetail]=useState<NotificationDetail|null>(null),[detailBusy,setDetailBusy]=useState(false),[viewerPage,setViewerPage]=useState<number|null>(null),[viewersBusy,setViewersBusy]=useState(false),[viewersOpen,setViewersOpen]=useState(false);
 const [syncing,setSyncing]=useState(false);
 const [compose,setCompose]=useState(false),[sending,setSending]=useState(false),[notice,setNotice]=useState('');
 const [catalog,setCatalog]=useState<AcademicCatalog>({courses:[],programmes:[],plans:[],subjects:[]}),[catalogBusy,setCatalogBusy]=useState(false);
 const [course,setCourse]=useState(''),[programme,setProgramme]=useState(''),[plans,setPlans]=useState<string[]>([]),[title,setTitle]=useState(''),[body,setBody]=useState('');
 const [files,setFiles]=useState<File[]>([]),[audience,setAudience]=useState<number|null>(null),[audienceError,setAudienceError]=useState(''),[draftError,setDraftError]=useState('');
 const [audienceRetry,setAudienceRetry]=useState(0),[refresh,setRefresh]=useState(0);
 const requestId=useRef(crypto.randomUUID()),detailSequence=useRef(0),listSequence=useRef(0),hasUnsent=useRef(false);
 hasUnsent.current=Boolean(title||body||files.length);
 useEffect(()=>{requestId.current=crypto.randomUUID()},[title,body,course,programme,plans,files]);
 useEffect(()=>{if(admin)void academicClient.getCatalog().then(setCatalog).catch(()=>{})},[admin]);
 const load=useCallback(async()=>{
  const sequence=++listSequence.current;setLoading(true);setError('');
  try{const result=await notificationsClient.list(admin,{kind,q:query,page,unread});if(sequence!==listSequence.current)return;setItems(result.items);setTotal(result.total);setNextPage(result.nextPage);}
  catch(cause){if(sequence===listSequence.current)setError(cause instanceof Error?cause.message:'Unable to load notifications');}
  finally{if(sequence===listSequence.current)setLoading(false);}
 },[admin,kind,query,page,unread]);
 useEffect(()=>{let current=true;const timer=setTimeout(()=>{if(current)void load()},250);return()=>{current=false;listSequence.current++;clearTimeout(timer)}},[load,refresh]);
 useEffect(()=>()=>{detailSequence.current++},[]);
 useWorkspaceChanges(change=>{if(change.inboxChanged||admin&&change.contentChanged)setRefresh(value=>value+1)});
 // Admin lists also show batch-delivery progress; no student inbox polling.
 useEffect(()=>{if(!admin)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1)},15000);return()=>clearInterval(timer)},[admin]);
 useEffect(()=>{setDetail(previous=>{if(!previous||!admin)return previous;const latest=items.find(item=>item.id===previous.id);return latest?{...previous,deliveryJob:latest.deliveryJob,recipients:latest.recipients,viewers:latest.viewers}:previous})},[items,admin]);
 const syncPublications=async()=>{
  if(!window.confirm('Create missing notifications for already published materials and sessions? Active eligible students will receive them. Existing notifications will not be duplicated. Saved drafts will stay private.'))return;
  setSyncing(true);setError('');
  try{const result=await notificationsClient.syncPublications();setNotice(`${result.created} missing publication notifications recovered.${result.hasMore?' Click Sync published updates again to recover the next batch.':''}`);setKind('REGULAR');setPage(1);setQuery('');setRefresh(value=>value+1)}
  catch(cause){setError(cause instanceof Error?cause.message:'Unable to recover publication notifications')}
  finally{setSyncing(false)}
 };
 const target=useMemo<NotificationTarget>(()=>({courseIds:course?[course]:[],programmeIds:programme?[programme]:[],planIds:plans}),[course,programme,plans]);
 useEffect(()=>{
  let current=true;setAudience(null);setAudienceError('');
  if(!compose||!course&&!programme&&!plans.length)return;
  const timer=setTimeout(()=>{void notificationsClient.audience(target).then(result=>{if(current)setAudience(result.count)}).catch(cause=>{if(current)setAudienceError(cause instanceof Error?cause.message:'Unable to check audience')})},300);
  return()=>{current=false;clearTimeout(timer)};
 },[compose,target,audienceRetry]);
 useEffect(()=>{
  if(!compose&&!detail&&!detailBusy)return;
  const previous=document.activeElement as HTMLElement|null;
  const handle=(event:KeyboardEvent)=>{
   const dialog=document.querySelector<HTMLElement>('.nc-compose-overlay [role="dialog"],.nc-detail-overlay [role="dialog"]');
   if(!dialog)return;
   if(event.key==='Escape'&&!sending){event.preventDefault();if(compose){if(hasUnsent.current&&!window.confirm('Discard this unsent notification?'))return;setCompose(false)}else{detailSequence.current++;setDetail(null);setDetailBusy(false)}}
   if(event.key==='Tab'){
    const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.offsetParent!==null);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  };
  document.addEventListener('keydown',handle);
  const timer=setTimeout(()=>document.querySelector<HTMLElement>('.nc-compose-overlay button,.nc-detail-overlay button')?.focus(),0);
  return()=>{document.removeEventListener('keydown',handle);clearTimeout(timer);previous?.focus()};
 },[compose,Boolean(detail),detailBusy,sending]);
 const openCompose=()=>{
  setCompose(true);setDraftError('');setNotice('');setCatalogBusy(true);setFiles([]);setTitle('');setBody('');setCourse('');setProgramme('');setPlans([]);requestId.current=crypto.randomUUID();
  void academicClient.getCatalog().then(setCatalog).catch(cause=>setDraftError(cause instanceof Error?cause.message:'Unable to load audience choices')).finally(()=>setCatalogBusy(false));
 };
 const openMessage=async(message:NotificationMessage)=>{
  const sequence=++detailSequence.current;setDetail(null);setDetailBusy(true);setError('');setViewersOpen(false);setViewerPage(null);
  try{
   const result=admin?await notificationsClient.detail(message.id):await notificationsClient.read(message.id);
   if(sequence!==detailSequence.current)return;
   setDetail(result);setViewerPage('nextPage' in result?result.nextPage as number|null:null);
   if(!admin){setItems(previous=>previous.map(item=>item.id===message.id?{...item,readAt:item.readAt||new Date().toISOString()}:item));onUnreadChange?.();refreshWorkspaceChanges();}
  }catch(cause){if(sequence===detailSequence.current)setError(cause instanceof Error?cause.message:'Unable to open notification');}
  finally{if(sequence===detailSequence.current)setDetailBusy(false);}
 };
 const send=async()=>{
  if(!audience||!title.trim()||!body.trim()||sending)return;
  if(!window.confirm(`Send “${title.trim()}” to approximately ${audience} eligible students with ${files.length} attachments? Eligibility is checked again when sending.`))return;
  setSending(true);setDraftError('');
  try{
   const attachments=await Promise.all(files.map(async file=>({name:file.name,mimeType:file.type,base64:await readFile(file)})));
   const draft:NotificationDraft={title,body,target,attachments,requestId:requestId.current};
   const result=await notificationsClient.send(draft);setCompose(false);setNotice(result.queued?`Notification queued for ${result.recipients} eligible students. Delivery progress appears in the list.`:`Notification sent to ${result.recipients} students.`);setPage(1);setKind('CUSTOM');setQuery('');setRefresh(v=>v+1);
  }catch(cause){setDraftError(cause instanceof Error?cause.message:'Unable to send notification');}
  finally{setSending(false);}
 };
 const chooseFiles=(selected:File[])=>{
  const next=[...files,...selected];
  if(next.length>3||next.some(f=>f.size>5*1024*1024)||next.reduce((sum,f)=>sum+f.size,0)>10*1024*1024){setDraftError('Attach up to 3 files, 5 MB each and 10 MB total.');return;}
  setFiles(next);setDraftError('');
 };
 const download=async(id:string,file:NotificationMessage['attachments'][number])=>{try{await notificationsClient.download(id,file)}catch(cause){setError(cause instanceof Error?cause.message:'Unable to download attachment')}};
 const moreViewers=async()=>{
  if(!detail||!viewerPage||viewersBusy)return;setViewersBusy(true);
  const id=detail.id,sequence=detailSequence.current;
  try{const result=await notificationsClient.detail(id,viewerPage);if(sequence!==detailSequence.current)return;setDetail(previous=>previous?.id===id?{...result,people:[...(previous.people??[]),...(result.people??[])]}:previous);setViewerPage(result.nextPage)}
  catch(cause){setError(cause instanceof Error?cause.message:'Unable to load viewers')}finally{setViewersBusy(false)}
 };
 const liveCourses=catalog.courses.filter(c=>!c.hidden&&!c.accessLocked&&!c.archivedAt);
 const liveProgrammes=catalog.programmes.filter(p=>p.locked&&!p.hidden&&!p.accessLocked&&!p.archivedAt&&(!course||p.courseId===course));
 const livePlans=catalog.plans.filter(p=>!p.hidden&&!p.accessLocked&&!p.archivedAt&&(!course||p.courseId===course)&&(!programme||catalog.programmes.find(g=>g.id===programme)?.planIds.includes(p.id)));
 return <section className="nc-workspace" aria-label={admin?'Notification center':'Notification inbox'}>
  <header className="nc-heading"><div><div className="nc-eyebrow"><Bell size={14}/> {admin?'COMMUNICATIONS':'YOUR MESSAGES'}</div><h1>{admin?'Notification center':'Inbox'}</h1><p>{admin?'Send focused updates. See who has opened each message.':'Course updates, new materials and live sessions, all in one place.'}</p></div><div className="nc-toolbar">{admin&&<button className="a-btn" disabled={syncing||!canManage} onClick={()=>void syncPublications()}><RefreshCw size={15}/>{syncing?'Syncing…':'Sync published updates'}</button>}{admin&&<button className="a-btn primary" disabled={!canManage} onClick={openCompose}><Plus size={16}/> Compose notification</button>}</div></header>
  {notice&&<p className="nc-success" role="status"><Check size={16}/>{notice}</p>}
  {error&&<p className="nc-error" role="alert">{error}</p>}
  <div className="nc-inbox">
   <aside className="nc-sidebar"><div className="nc-folder-label">{admin?'NOTIFICATION HISTORY':'MAILBOX'}</div>{[['ALL',admin?'All notifications':'All messages',Inbox],['CUSTOM','Custom',Mail],['REGULAR','Regular updates',CalendarDays]].map(([value,text,Icon])=>{const Symbol=Icon as typeof Inbox;return <button key={String(value)} className={kind===value?'selected':''} onClick={()=>{setKind(String(value));setPage(1);setDetail(null)}}><Symbol size={17}/>{String(text)}</button>})}{!admin&&<label className="nc-unread-filter"><input type="checkbox" checked={unread} onChange={e=>{setUnread(e.target.checked);setPage(1)}}/> Unread only</label>}<p>Regular updates are sent automatically when a material or session is published.</p></aside>
   <div className="nc-mail-area"><div className="nc-list-toolbar"><label className="nc-search"><Search size={16}/><input aria-label="Search notifications" placeholder="Search messages…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label><span>{total} messages</span></div>
    {loading?<div className="nc-empty" role="status">Loading messages…</div>:!items.length?<div className="nc-empty"><Inbox size={35}/><h2>Your inbox is clear</h2><p>{admin?'Compose your first notification, or publish a session or material.':'New notifications will appear here when your course team sends an update.'}</p></div>:<div className="nc-messages">{items.map(message=><button key={message.id} className={`nc-message ${!admin&&!message.readAt?'unread':''} ${detail?.id===message.id?'selected':''}`} onClick={()=>void openMessage(message)}><span className={`nc-message-icon ${message.kind.toLowerCase()}`}>{message.kind==='SESSION'?<CalendarDays size={19}/>:message.kind==='MATERIAL'?<FileText size={19}/>:<Mail size={19}/>}</span><span className="nc-message-content"><span className="nc-message-title">{message.title}{!admin&&!message.readAt&&<i aria-label="Unread"/>}</span><span className="nc-message-preview">{message.body.replace(/\n/g,' ')}</span><span className="nc-message-tags"><span>{label(message.kind)}</span>{message.attachments.length>0&&<span><Paperclip size={12}/>{message.attachments.length} {message.attachments.length===1?'attachment':'attachments'}</span>}{admin&&<><span><Eye size={13}/>{message.viewers} / {message.recipients} viewed</span>{message.deliveryJob&&<span>{message.deliveryJob.lastError?'Delivery retry pending':message.deliveryJob.completedAt?'Delivery complete':`Sending · ${message.deliveryJob.delivered} delivered`}</span>}</>}</span></span><time>{when(message.createdAt)}</time></button>)}</div>}
    <footer className="nc-pagination"><span>Page {page}</span><button aria-label="Previous notification page" disabled={page===1||loading} onClick={()=>setPage(v=>v-1)}><ChevronLeft size={17}/></button><button aria-label="Next notification page" disabled={!nextPage||loading} onClick={()=>setPage(nextPage!)}><ChevronRight size={17}/></button></footer>
   </div>
  </div>
  {(detail||detailBusy)&&<div className="nc-detail-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){detailSequence.current++;setDetail(null);setDetailBusy(false)}}}><section className="nc-detail" role="dialog" aria-modal="true" aria-label="Notification details"><button className="nc-close" aria-label="Close notification" onClick={()=>{detailSequence.current++;setDetail(null);setDetailBusy(false)}}><X size={20}/></button>{detailBusy?<p role="status">Opening message…</p>:detail&&<><span className="nc-badge">{label(detail.kind)}</span><h2>{detail.title}</h2><div className="nc-sender"><span className="nc-sender-avatar">DT</span><div><strong>DocTutorials team</strong><small>{when(detail.createdAt)} IST{admin?` · ${detail.recipients} recipients`:''}</small></div></div>{admin&&detail.deliveryJob&&<p className="nc-delivery-status" role="status">{detail.deliveryJob.lastError?'Delivery will retry automatically.':detail.deliveryJob.completedAt?'Delivery complete.':`Sending in progress · ${detail.deliveryJob.delivered} students delivered so far.`}</p>}{admin&&<div className="nc-target-summary"><strong>Audience</strong><span>{detail.courseIds.length?detail.courseIds.map(id=>catalog.courses.find(c=>c.id===id)?.name||'Selected course').join(', '):'Any course'}</span><span>{detail.programmeIds.length?detail.programmeIds.map(id=>catalog.programmes.find(p=>p.id===id)?.name||'Selected programme').join(', '):'Any programme'}</span><span>{detail.planIds.length?detail.planIds.map(id=>catalog.plans.find(p=>p.id===id)?.name||'Selected plan').join(', '):'All eligible plans'}</span></div>}<div className="nc-message-body">{detail.body}</div>{!admin&&detail.sourceId&&detail.kind==='MATERIAL'&&<button className="a-btn" onClick={()=>{setMaterialPreview({id:detail.sourceId!,title:detail.title.replace(/^New material: /,'')});setDetail(null)}}><FileText size={16}/> Open published material</button>}{!admin&&detail.kind==='SESSION'&&onSession&&<button className="a-btn" onClick={onSession}><CalendarDays size={16}/> Open my schedule</button>}{detail.attachments.length>0&&<div className="nc-attachments"><h3><Paperclip size={16}/>{detail.attachments.length} {detail.attachments.length===1?'attachment':'attachments'}</h3>{detail.attachments.map(file=><button key={file.id} onClick={()=>void download(detail.id,file)}><FileText size={20}/><span><strong>{file.name}</strong><small>{(file.size/1024).toFixed(1)} KB</small></span><Download size={17}/></button>)}</div>}{admin&&<div className="nc-viewers"><button onClick={()=>setViewersOpen(v=>!v)} aria-expanded={viewersOpen}><Eye size={18}/><strong>{detail.viewers} viewers</strong><span>of {detail.recipients} recipients</span><ChevronRight size={17}/></button>{viewersOpen&&<><p>Each student is counted once, when they open this notification.</p>{!detail.people?.length&&<p>No viewers yet.</p>}{detail.people?.map(person=><div className="nc-viewer" key={person.user.id}><span><strong>{person.user.displayName||'Student'}</strong><small>{person.user.email}</small></span><time>{when(person.readAt)}</time></div>)}{viewerPage&&<button className="a-btn" disabled={viewersBusy} onClick={()=>void moreViewers()}>{viewersBusy?'Loading…':'More viewers'}</button>}</>}</div>}</>}</section></div>}
  {compose&&<div className="nc-compose-overlay"><section className="nc-compose" role="dialog" aria-modal="true" aria-labelledby="nc-compose-title"><header><div><span className="nc-eyebrow">CUSTOM NOTIFICATION</span><h2 id="nc-compose-title">A message for your students</h2></div><button aria-label="Close composer" disabled={sending} onClick={()=>{if(hasUnsent.current&&!window.confirm('Discard this unsent notification?'))return;setCompose(false)}}><X size={21}/></button></header><fieldset disabled={sending}>
   <div className="nc-compose-grid"><div className="nc-compose-main"><label>Start with a template<select aria-label="Start with a template" defaultValue="" onChange={e=>{const t=templates[Number(e.target.value)];if(t){setTitle(t.title);setBody(t.body)}}}><option value="" disabled>Choose a message template</option>{templates.map((t,i)=><option key={t.name} value={i}>{t.name}</option>)}</select></label><label>Subject<input maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What would you like students to know?"/></label><label>Message<textarea rows={12} maxLength={12000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message here…"/></label><span className="nc-char-count">{body.length.toLocaleString()} / 12,000</span><div className="nc-file-picker"><label><Paperclip size={16}/> Attach files<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" onChange={e=>{chooseFiles(Array.from(e.target.files??[]));e.target.value=''}}/></label><small>3 files · 5 MB each · 10 MB total</small></div>{files.map((f,index)=><div className="nc-draft-file" key={`${f.name}:${index}`}><FileText size={16}/>{f.name}<button aria-label={`Remove ${f.name}`} onClick={()=>setFiles(previous=>previous.filter((_,i)=>i!==index))}><X size={15}/></button></div>)}</div>
   <aside className="nc-audience"><h3><Users size={17}/> Who will receive this?</h3><p>Select a course, programme or plans. Additional selections narrow your audience.</p>{catalogBusy?<p role="status">Loading selections…</p>:<><label>Course<select aria-label="Course" value={course} onChange={e=>{setCourse(e.target.value);setProgramme('');setPlans([])}}><option value="">Any course</option>{liveCourses.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Programme<select aria-label="Programme" value={programme} onChange={e=>{setProgramme(e.target.value);setPlans([])}}><option value="">Any programme</option>{liveProgrammes.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><div className="nc-plan-label">Plans <small>Optional</small></div><div className="nc-plan-list">{livePlans.map(p=><label key={p.id}><input type="checkbox" checked={plans.includes(p.id)} onChange={()=>setPlans(previous=>previous.includes(p.id)?previous.filter(id=>id!==p.id):[...previous,p.id])}/>{p.name}</label>)}</div></>}<div className="nc-audience-count"><Users size={20}/><strong>{audience===null?'—':audience.toLocaleString()}</strong><span>eligible students</span></div><p>Only active, unlocked student subscriptions receive messages. Each student receives one copy.</p>{audienceError&&<p className="nc-error" role="alert">{audienceError}<button onClick={()=>setAudienceRetry(v=>v+1)}>Retry</button></p>}</aside></div>
  </fieldset>{draftError&&<p className="nc-error" role="alert">{draftError}</p>}<footer><span><Bell size={14}/> In-app notification</span><button className="a-btn primary" disabled={sending||!audience||title.trim().length<2||!body.trim()||catalogBusy} onClick={()=>void send()}><Send size={16}/>{sending?'Sending…':`Send${audience?` to ${audience} students`:''}`}</button></footer></section></div>}
 {materialPreview&&<DocumentPreview documentId={materialPreview.id} title={materialPreview.title} onClose={()=>setMaterialPreview(null)}/>}
 </section>;
}
