import {useWorkspaceChanges,refreshWorkspaceChanges} from './workspace-changes';
import {todaySessionAlerts} from './student-session-alerts';
import {NotificationsWorkspace} from './NotificationsWorkspace';
import {notificationsClient} from './notifications-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, FileText, FolderOpen, GraduationCap, Pin, RefreshCw, ShieldCheck } from 'lucide-react';
import StudentPortal from './StudentPortal';
import StudentLauncher, { type StudentModule } from './StudentLauncher';
import { TilePictogram, subjectSymbol } from './TilePictogram';
import { DocumentPreview } from './DocumentPreview';
import { documentApi, type StudentCatalogue, type StudentMaterial } from './uploads-client';
import {sessionsClient,type StudentLiveSession,type StudentAttendanceIntent,type SessionTab} from './sessions-client';
import {CalendarDays} from 'lucide-react';
import StudentSessionsTable from './StudentSessionsTable';
import './student-tiles.css';
import './student-documents.css';

const devicePinsKey = 'dochub-student-document-shortcuts';
function readPins(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(devicePinsKey) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export default function StudentDocumentsWorkspace({ onSwitchProfile, studentName = 'Student', initialView = 'Home' }: { onSwitchProfile?: () => void; studentName?: string; initialView?: 'Home' | 'Learning' }) {
  const [unreadCount,setUnreadCount]=useState(0);
  const refreshUnread=useCallback(()=>{refreshWorkspaceChanges();void notificationsClient.unread().then(result=>setUnreadCount(result.count)).catch(()=>setUnreadCount(0))},[]);

  const [view, setView] = useState<'Home' | StudentModule>(initialView);
  const [catalogue, setCatalogue] = useState<StudentCatalogue>({ programmes: [] });
  const [documents, setDocuments] = useState<StudentMaterial[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [documentFolderId,setDocumentFolderId]=useState<string|null>(null);
  const [studentFolders,setStudentFolders]=useState<Array<{id:string;name:string}>>([]);
  const [preview, setPreview] = useState<StudentMaterial | null>(null);
  const [sessionTab,setSessionTab]=useState<SessionTab>('All');
  const [sessions,setSessions]=useState<StudentLiveSession[]>([]);
  const [nextSessionsPage,setNextSessionsPage]=useState<number|null>(null);
  const [sessionsRefresh,setSessionsRefresh]=useState(0);
  const [todaySessions,setTodaySessions]=useState<StudentLiveSession[]>([]);
  const [alertTime,setAlertTime]=useState(Date.now());
  useEffect(()=>{
    let alive=true,sequence=0;
    const refresh=async()=>{
      const request=++sequence;
      try{
        let next:number|null=1;const items:StudentLiveSession[]=[];
        while(next!==null){
          const result=await sessionsClient.student(undefined,'Today',next);
          if(!alive||request!==sequence)return;
          items.push(...result.items);next=result.nextPage??null;
        }
        setTodaySessions(todaySessionAlerts(items));setAlertTime(Date.now());
      }catch{if(alive&&request===sequence)setTodaySessions([]);}
    };
    let day=new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'});
    void refresh();const timer=setInterval(()=>{setAlertTime(Date.now());const next=new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'});if(next!==day){day=next;void refresh()}},60000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);
    return()=>{alive=false;sequence++;clearInterval(timer);window.removeEventListener('focus',focus)};
  },[sessionsRefresh]);
  const [attendanceSaving,setAttendanceSaving]=useState<string|null>(null);
  const [sessionError,setSessionError]=useState('');
  const [sessionLoading,setSessionLoading]=useState(false);
  const [pins, setPins] = useState<string[]>(readPins);
  const alive=useRef(true),loadSequence = useRef(0),inFlight=useRef(0),pendingRefresh=useRef(false),loadedCount=useRef(0),previewRef=useRef(preview),moreRef=useRef(moreBusy);
  loadedCount.current=documents.length;previewRef.current=preview;moreRef.current=moreBusy;

  const load = useCallback(async (background=false):Promise<void> => {
    if(background&&(inFlight.current||moreRef.current)){pendingRefresh.current=true;return;}inFlight.current++;
    const sequence=++loadSequence.current;
    if(!background)setLoading(true); setError('');
    try {
      const [programmes, page] = await Promise.all([documentApi.studentCatalogue(), documentApi.studentMaterials()]);
      if(sequence!==loadSequence.current)return;
      const items=[...page.items];let last=page;
      while(background&&last.nextCursor&&items.length<loadedCount.current){last=await documentApi.studentMaterials(last.nextCursor);items.push(...last.items)}
      const eligible=new Set(items.map(item=>item.id));
      const opened=previewRef.current;if(opened&&!eligible.has(opened.id)){try{await documentApi.read(opened.id);eligible.add(opened.id)}catch{}}
      if(sequence!==loadSequence.current)return;
      setCatalogue(programmes); setDocuments(items); setCursor(last.nextCursor);
      setPreview(previous=>previous&&!eligible.has(previous.id)?null:previous);
    } catch (cause) {
      if(sequence!==loadSequence.current)return;
      // Never retain old course names or material titles when revalidation fails.
      setCatalogue({programmes:[]}); setDocuments([]); setCursor(null); setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load your learning materials');
    } finally {inFlight.current--;if(sequence===loadSequence.current&&!background)setLoading(false);if(alive.current&&!inFlight.current&&pendingRefresh.current){pendingRefresh.current=false;void load(true)} }
  }, []);
  useEffect(() => { alive.current=true;void load(); return()=>{alive.current=false;pendingRefresh.current=false;loadSequence.current++}; }, [load]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void load(true)};

    window.addEventListener('focus',refresh);
    window.addEventListener('pageshow',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{
      window.removeEventListener('focus',refresh);
      window.removeEventListener('pageshow',refresh);
      document.removeEventListener('visibilitychange',refresh);
    };
  },[load]);
  useWorkspaceChanges(change=>{setUnreadCount(change.unreadCount);if(change.contentChanged){void load(true);setSessionsRefresh(n=>n+1)}});
  const loadMore = async () => {
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    const sequence=loadSequence.current;
    try {
      const page = await documentApi.studentMaterials(cursor);
      if(sequence!==loadSequence.current)return;
      setDocuments(previous => [...previous, ...page.items]); setCursor(page.nextCursor);
    } catch (cause) { if(sequence===loadSequence.current)setError(cause instanceof Error ? cause.message : 'Unable to load more materials'); }
    finally { setMoreBusy(false);moreRef.current=false;if(alive.current&&pendingRefresh.current){pendingRefresh.current=false;void load(true)} }
  };
  useEffect(()=>{
    if(view!=='Sessions')return;
    let cancelled=false;setSessionLoading(true);setSessionError('');setSessions([]);setNextSessionsPage(null);
    void sessionsClient.student(undefined,sessionTab).then(result=>{if(!cancelled){setSessions(result.items);setNextSessionsPage(result.nextPage)}}).catch(cause=>{if(!cancelled){setSessions([]);setSessionError(cause instanceof Error?cause.message:'Unable to load sessions')}}).finally(()=>{if(!cancelled)setSessionLoading(false)});
    return()=>{cancelled=true};
  },[view,sessionTab,sessionsRefresh]);
  const moreSessions=async()=>{
    const next=nextSessionsPage;if(next===null||sessionLoading)return;
    setSessionLoading(true);setSessionError('');
    try{const response=await sessionsClient.student(undefined,sessionTab,next);setSessions(previous=>[...previous,...response.items.filter(row=>!previous.some(old=>old.id===row.id))]);setNextSessionsPage(response.nextPage)}
    catch(cause){setSessionError(cause instanceof Error?cause.message:'Unable to load more sessions')}
    finally{setSessionLoading(false)}
  };
  const submitAttendance=async(sessionId:string,response:StudentAttendanceIntent)=>{
    if(attendanceSaving)return;
    setAttendanceSaving(sessionId);setSessionError('');
    try{const saved=await sessionsClient.submitAttendance(sessionId,response);
      setSessions(previous=>previous.map(row=>row.id===sessionId?{...row,attendance:{response:saved.response,markedAt:saved.markedAt}}:row));
    }catch(cause){setSessionError(cause instanceof Error?cause.message:'Attendance submission failed');throw cause}
    finally{setAttendanceSaving(null)}
  };
  const navigate = (target: 'Home' | StudentModule) => {
    if (target === 'Learning') { setProgrammeId(''); setSubjectId(''); }
    setView(target);
  };
  const allowedIds = useMemo(() => new Set(documents.map(d => d.id)), [documents]);
  const pinnedDocs = documents.filter(d => pins.includes(d.id) && allowedIds.has(d.id));
  const togglePin = (documentId: string) => {
    setPins(prev => {
      const next = prev.includes(documentId) ? prev.filter(id => id !== documentId) : [...prev, documentId];
      try { localStorage.setItem(devicePinsKey, JSON.stringify(next)); } catch { /* device preferences are optional */ }
      return next;
    });
  };
  const programme = catalogue.programmes.find(p => p.id === programmeId);
  const subject = programme?.subjects.find(s => s.id === subjectId);
  useEffect(()=>{
    if(programmeId&&!programme){setProgrammeId('');setSubjectId('');setDocumentFolderId(null);return;}
    if(subjectId&&!subject){setSubjectId('');setDocumentFolderId(null);}
  },[programmeId,programme,subjectId,subject]);
  useEffect(()=>{
    if(!programmeId||!subjectId){setStudentFolders([]);setDocumentFolderId(null);return;}
    let cancelled=false;
    void documentApi.studentFolders(programmeId,subjectId).then(data=>{if(!cancelled)setStudentFolders(data.items)}).catch(()=>{if(!cancelled)setStudentFolders([])});
    return()=>{cancelled=true};
  },[programmeId,subjectId]);
  const subjectDocuments = documents.filter(d => d.programmeId === programmeId && d.subjectId === subjectId && (documentFolderId===null || d.folderId===documentFolderId));
  const courseLabel = catalogue.programmes[0]?.courseName ?? 'Your learning';
  const cards = catalogue.programmes.map(p => ({
    id: p.id, name: p.name, subjectCount: p.subjects.length,
    materialCount: documents.filter(d => d.programmeId === p.id).length,
  }));
  const pinned = pinnedDocs.map(p => ({ id: p.id, name: p.title, pages: p.pageCount ?? 0 }));
  const openProgramme = (id: string) => { setProgrammeId(id); setSubjectId(''); setView('Learning'); };
  const openDocument = (id: string) => { const entry = documents.find(d => d.id === id); if (entry) setPreview(entry); };

  return <>
    <StudentPortal view={view} onView={navigate} onAdmin={onSwitchProfile} studentName={studentName} unread={unreadCount} onResult={(module,id)=>{navigate(module==='Uploads'?'Learning':module as StudentModule);if(module==='Learning'&&id){setProgrammeId(id);setSubjectId('')}}}>
      {todaySessions.length>0&&<aside className="student-today-alert" role="status" aria-live="polite"><span className="student-today-alert-icon"><CalendarDays size={21}/></span><div><strong>{Date.parse(todaySessions[0]!.startAt)<=alertTime?'Your session is live now':Date.parse(todaySessions[0]!.startAt)-alertTime<=30*60_000?'Your session starts soon':'You have a session today'}{todaySessions.length>1?` · ${todaySessions.length} sessions today`:''}</strong><p>{todaySessions[0]!.topic} · {new Date(todaySessions[0]!.startAt).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})} IST · {todaySessions[0]!.facultyName}</p></div><button type="button" onClick={()=>{setSessionTab('Today');setView('Sessions');setSessionsRefresh(v=>v+1)}}>View today’s sessions <ChevronRight size={15}/></button></aside>}
      {error && <div className="student-api-notice" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
      {loading && view!=='Sessions' && view!=='Notifications' ? <div className="st-learning-empty" role="status"><RefreshCw size={22} /> Loading your subscribed materials…</div> :
        view === 'Home' ? <StudentLauncher courseName={courseLabel} programmes={cards} pinned={pinned} sessionsCount={todaySessions.length} unreadCount={unreadCount}
          onModule={navigate} onProgramme={openProgramme} onPdf={openDocument} /> :
        view === 'Learning' ? <section className="st-learning" aria-label="My learning">
          <div className="st-learning-heading"><div><div className="st-overline"><GraduationCap size={15}/> YOUR SUBSCRIBED LEARNING</div><h1>My learning</h1><p>Course → Programme → Subject → Published materials</p></div></div>
          <div className="st-learning-path">
            <button onClick={() => { setProgrammeId(''); setSubjectId(''); }}><BookOpen size={15}/> Programmes</button>
            {programme && <><ChevronRight size={15}/><button onClick={() => {setSubjectId('');setDocumentFolderId(null)}}>{programme.name}</button></>}
            {subject && <><ChevronRight size={15}/><span className="is-current st-path-current">{subject.name}</span></>}
          </div>
          {!programme ? <>
            <div className="st-learning-section-title"><div><span className="st-overline">YOUR COURSE CATALOGUE</span><h2>Browse by programme</h2></div></div>
            <div className="st-learning-tile-grid st-learning-programmes">
              {catalogue.programmes.map((p, index) => <button key={p.id} className={`st-learning-tile st-learning-programme st-programme-tone-${index%4}`} onClick={() => openProgramme(p.id)}>
                <span className="st-learning-tile-top"><TilePictogram symbol="learning" size={64}/><ChevronRight size={17}/></span>
                <span className="st-learning-tile-copy"><strong>{p.name}</strong><small>{p.courseName} · {p.subjects.length} subjects</small><em>Open programme</em></span>
              </button>)}
            </div>
            {!catalogue.programmes.length && <div className="st-learning-empty"><ShieldCheck size={24}/><strong>No active subscriptions</strong><p>Your administrator must assign an active course, programme, subject and plan before materials become available.</p></div>}
          </> : !subject ? <>
            <div className="st-learning-section-title"><div><span className="st-overline">{programme.name}</span><h2>Choose a subject</h2></div></div>
            <div className="st-learning-tile-grid st-learning-subjects">
              {programme.subjects.map((s,index) => <button key={s.id} className={`st-learning-tile st-learning-subject st-${subjectSymbol(s.name)} st-learning-subject-tone-${index%4}`} onClick={() => {setSubjectId(s.id);setDocumentFolderId(null)}}>
                <span className="st-learning-tile-top"><TilePictogram symbol={subjectSymbol(s.name)} size={64}/><ChevronRight size={17}/></span>
                <span className="st-learning-tile-copy"><strong>{s.name}</strong><small>{documents.filter(d => d.programmeId === programme.id && d.subjectId === s.id).length} published materials</small><em>Open subject</em></span>
              </button>)}
            </div>
          </> : <>
            <div className="st-learning-section-title"><div><span className="st-overline">{subject.name}</span><h2>Study materials</h2><p>Choose a folder, or view all published PDFs for this subject.</p></div><span className="st-result-count">{subjectDocuments.length} materials</span></div>
            {studentFolders.length>0&&<div className="student-folder-tabs"><button type="button" className={!documentFolderId?'selected':''} onClick={()=>setDocumentFolderId(null)}><BookOpen size={15}/> All materials</button>{studentFolders.map(f=><button type="button" key={f.id} className={documentFolderId===f.id?'selected':''} onClick={()=>setDocumentFolderId(f.id)}><FolderOpen size={15}/>{f.name}</button>)}</div>}
            <div className="st-learning-tile-grid st-learning-documents">
              {subjectDocuments.map((d,index) => <article key={d.id} className={`st-document-tile st-document-tone-${index%4}`}>
                <button className="st-document-open" onClick={() => setPreview(d)} aria-label={`Preview ${d.title}`}>
                  <span className="st-document-icon"><FileText size={27}/><small>PDF</small></span>
                  <span className="st-document-copy"><strong title={d.title}>{d.title}</strong><small>{d.programmeName}</small></span>
                  <span className="st-document-meta"><span>{d.pageCount ?? '—'} pages</span><span>Preview PDF</span></span>
                </button>
                <button className={`st-document-pin ${pins.includes(d.id)?'is-pinned':''}`} aria-pressed={pins.includes(d.id)} aria-label={`${pins.includes(d.id)?'Unpin':'Pin'} ${d.title}`} onClick={() => togglePin(d.id)}><Pin size={17}/></button>
              </article>)}
            </div>
            {!subjectDocuments.length && <div className="st-learning-empty"><FileText size={24}/><strong>No published materials yet</strong><p>Materials appear after processing and publication.</p></div>}
          </>}
        </section> : view === 'Sessions' ? <section className="st-learning" aria-label="My schedule">
          <div className="st-learning-heading"><div><div className="st-overline"><CalendarDays size={15}/> SUBSCRIBED LIVE LEARNING</div><h1>My Schedule</h1><p>All sessions across your subscribed programmes, with final attendance responses.</p></div></div>
          <StudentSessionsTable items={sessions} tab={sessionTab} onTab={setSessionTab} loading={sessionLoading} error={sessionError} nextPage={nextSessionsPage} onMore={()=>void moreSessions()} onAttendance={submitAttendance} savingId={attendanceSaving}/>
        </section> : view === 'Notifications' ? <NotificationsWorkspace onUnreadChange={refreshUnread} onSession={()=>{setSessionTab('All');setView('Sessions')}}/> : view === 'Pinned PDFs' ? <section className="st-learning"><h1>Pinned PDFs</h1><p className="student-pinned-note">Shortcuts saved on this device. Access is checked again before every preview.</p>
          <div className="st-learning-tile-grid st-learning-documents">{pinnedDocs.map(d => <button key={d.id} className="st-learning-tile" onClick={() => setPreview(d)}><FileText size={25}/><strong>{d.title}</strong><span>Preview PDF</span></button>)}</div>
          {!pinnedDocs.length && <div className="st-learning-empty">No pinned published PDFs.</div>}
        </section> : <div className="st-learning-empty"><ArrowLeft size={24}/><strong>{view} is not yet connected</strong><p>This module will display only authorized production data when its API integration is completed.</p><button className="student-refresh" onClick={() => navigate('Home')}>Back to learning</button></div>}
      {cursor && !loading && (view === 'Learning' || view === 'Home') && <div className="student-load-more"><button disabled={moreBusy} onClick={() => void loadMore()}>{moreBusy ? 'Loading…' : 'Load more materials'}</button></div>}
    </StudentPortal>
    {preview && <DocumentPreview documentId={preview.id} title={preview.title} onClose={() => setPreview(null)} />}
  </>;
}
