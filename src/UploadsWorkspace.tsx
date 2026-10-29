import {useCanManage} from './WorkspaceHeader';
import { useCallback, useEffect, useRef, useState, type FormEvent, type DragEvent } from 'react';
import { FileText, Eye, Upload, Search, RefreshCw, CheckCircle2, RotateCcw, Trash2, X, AlertCircle, LockKeyhole, FolderOpen, ArrowRight } from 'lucide-react';
import { DocumentPreview } from './DocumentPreview';
import { academicClient, type AcademicCatalog, type ProgrammeContext } from './academic-client';
import { programmesForCourse, selectedProgrammeInCourse } from './academic-selection';
import { getProgrammeReadiness } from './upload-mapping';
import { documentApi, uploadPdf, type DocumentRow, type UploadSelection } from './uploads-client';
import {folderApi,type FolderRow} from './folders-client';
import {Copy,ClipboardPaste,EyeOff,Eye as EyeIcon,Lock,Unlock,FolderPlus,Download,Printer,GripVertical,Folder,MoveRight,Palette, Pencil, Check, LoaderCircle} from 'lucide-react';
import { UploadsActionMenu } from './UploadsActionMenu';
import { canMoveTo, folderColors, type FolderColor, type MoveSource, type MoveDestination } from './folder-interactions';
import { ProgrammeCascadeStrip } from './ProgrammeCascadeStrip';
import './uploads.css';

type Props = Pick<AcademicCatalog,'courses'|'plans'|'subjects'|'programmes'> & {
  onCounts?: (total: number, published: number) => void;
  onOpenAcademicMapping: () => void;
};
const statusLabel: Record<string,string> = {
  UPLOADING: 'Uploading', QUEUED: 'Queued', PROCESSING: 'Processing', READY: 'Ready to publish',
  PUBLISHED: 'Published', FAILED: 'Failed', QUARANTINED: 'Quarantined', DELETED: 'Deleted',
};
const active = new Set(['UPLOADING','QUEUED','PROCESSING']);
const bytesLabel = (bytes: string | undefined) => bytes ? `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB` : '—';

export function UploadsWorkspace({courses,plans,subjects,programmes,onCounts,onOpenAcademicMapping}:Props) {
  const canManage=useCanManage('Uploads');
  const listRequest=useRef(0),listInFlight=useRef(0);
  const [catalog,setCatalog] = useState<AcademicCatalog>(() => ({courses,plans,subjects,programmes}));
  const [catalogLoading,setCatalogLoading] = useState(true);
  const [catalogError,setCatalogError] = useState('');
  const [formError,setFormError] = useState('');
  const [dragging,setDragging] = useState(false);
  const [uploadPolicyBytes,setUploadPolicyBytes] = useState<number|null>(null);
  const [courseId,setCourseId] = useState('');
  const [programmeId,setProgrammeId] = useState('');
  const [subjectFilter,setSubjectFilter]=useState('');
  const [folderFilter,setFolderFilter]=useState('');
  const [folders,setFolders]=useState<FolderRow[]>([]);
  const [modalFolders,setModalFolders]=useState<FolderRow[]>([]);
  const [clipboard,setClipboard]=useState<{type:'file'|'folder';id:string;title:string}|null>(null);
  const [folderBusy,setFolderBusy]=useState(false);
  const [folderEditor,setFolderEditor]=useState<FolderRow|'new'|{kind:'copy';folder:FolderRow}|null>(null);
  const [folderName,setFolderName]=useState('');
  const [folderColor,setFolderColor]=useState<FolderColor>('blue');
  const [dragItem,setDragItem]=useState<MoveSource|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null>(null);
  const [openFolderOptions,setOpenFolderOptions]=useState<string|null>(null);
  const [openDocumentOptions,setOpenDocumentOptions]=useState<string|null>(null);
  const [query,setQuery] = useState('');
  const [rows,setRows] = useState<DocumentRow[]>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const [loading,setLoading] = useState(false);
  const [actionBusy,setActionBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [modal,setModal] = useState(false);
  const [preview,setPreview] = useState<{id:string;title:string}|null>(null);
  const [replaceId,setReplaceId] = useState<string|undefined>();
  const [file,setFile] = useState<File|null>(null);
  const [title,setTitle] = useState('');
  const [formCourse,setFormCourse] = useState('');
  const [formProgramme,setFormProgramme] = useState('');
  const [formSubject,setFormSubject] = useState('');
  const [formFolder,setFormFolder] = useState('');
  const [formPlans,setFormPlans] = useState<string[]>([]);
  const [programmeContext,setProgrammeContext] = useState<ProgrammeContext|null>(null);
  const [programmeBusy,setProgrammeBusy] = useState(false);
  const [programmeError,setProgrammeError] = useState('');
  const [progress,setProgress] = useState<number|null>(null);
  const controller = useRef<AbortController|null>(null);
  const countCallback = useRef(onCounts);
  countCallback.current = onCounts;

  // Uploads obtains its own live catalogue. The parent workspace may have loaded
  // its academic state before the administrator created or locked a mapping.
  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const latest = await academicClient.getCatalog();
      setCatalog(latest);
      setCatalogError('');
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : 'Unable to load academic mappings');
    } finally { setCatalogLoading(false); }
  }, []);
  useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);
  const reloadAll = () => { void refreshCatalog(); void refresh(); };
  const setChosenFile = (chosen:File|null) => {
    if (chosen && !chosen.name.toLowerCase().endsWith('.pdf')) {
      setFormError('Only PDF documents can be uploaded.');
      setFile(null);
      return;
    }
    if (chosen && uploadPolicyBytes !== null && chosen.size > uploadPolicyBytes) {
      setFormError(`PDF exceeds the ${bytesLabel(String(uploadPolicyBytes))} upload limit.`);
      setFile(null);
      return;
    }
    if (chosen && chosen.size === 0) {
      setFormError('The selected PDF is empty. Choose another file.');
      setFile(null);
      return;
    }
    setFormError('');
    setFile(chosen);
    if (chosen) setTitle(previous => previous.trim() || chosen.name.replace(/\.pdf$/i,''));
  };
  const refresh = useCallback(async (append = false, pageCursor?: string, quiet=false) => {
    if(quiet&&listInFlight.current)return;const request=++listRequest.current;listInFlight.current++;
    if (!append&&!quiet) setLoading(true);
    try {
      const page = await documentApi.list({ courseId, programmeId, subjectId:subjectFilter||undefined,folderId:folderFilter||undefined, query: query.trim() || undefined, ...(append && pageCursor ? { cursor: pageCursor } : {}) });
      if(request!==listRequest.current)return;
      setRows(previous => append ? [...previous, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setError('');
      if (!append) countCallback.current?.(page.total, page.publishedTotal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load uploads');
    } finally { listInFlight.current--;if(request===listRequest.current&&!quiet)setLoading(false); }
  }, [courseId,programmeId,subjectFilter,folderFilter,query]);

  useEffect(() => { const timeout = setTimeout(() => void refresh(), 250); return () => clearTimeout(timeout); }, [refresh]);
  useEffect(() => {
    const interval = setInterval(() => {
      if(document.visibilityState==='visible')void refresh(false,undefined,true);
    }, rows.some(r=>active.has(r.latestVersion?.state??r.status)||r.latestVersion?.publishWhenReady)?2500:5000);
    return () => clearInterval(interval);
  }, [rows,refresh]);

  const {courses:liveCourses,subjects:liveSubjects,programmes:liveProgrammes} = catalog;
  const folderScope=liveProgrammes.find(p=>p.id===programmeId);
  const folderSubjectOptions=liveSubjects.filter(s=>folderScope?.subjectIds.includes(s.id));
  const loadFolders=useCallback(async()=>{
    if(!courseId||!programmeId||!subjectFilter){setFolders([]);return;}
    try{const data=await folderApi.list(courseId,programmeId,subjectFilter);setFolders(data.items);}
    catch(cause){setError(cause instanceof Error?cause.message:'Cannot load folders');}
  },[courseId,programmeId,subjectFilter]);
  useEffect(()=>{void loadFolders();},[loadFolders]);
  useEffect(()=>{
    if(!modal||!formCourse||!formProgramme||!formSubject){setModalFolders([]);return;}
    let cancelled=false;
    void folderApi.list(formCourse,formProgramme,formSubject).then(data=>{if(!cancelled)setModalFolders(data.items)}).catch(cause=>{if(!cancelled)setFormError(cause instanceof Error?cause.message:'Cannot load available folders')});
    return()=>{cancelled=true};
  },[modal,formCourse,formProgramme,formSubject]);
  const folderAction=async(work:()=>Promise<unknown>,successMessage='Folder or file change saved'):Promise<boolean>=>{
    setFolderBusy(true);setError('');
    try{
      await work();
      await Promise.all([loadFolders(),refresh()]);
      setNotice(successMessage);
      setOpenFolderOptions(null);setOpenDocumentOptions(null);
      return true;
    }
    catch(cause){setError(cause instanceof Error?cause.message:'Folder operation failed');return false;}
    finally{setFolderBusy(false);}
  };
  const changeDocumentPermission = (row:DocumentRow, flag:'allowDownload'|'allowPrint') => {
    const enabled=!row[flag];
    void folderAction(()=>folderApi.organize(row.id,row.revision,{[flag]:enabled}), 'Document permission saved');
  };
  const openFolderEditor=(folder?:FolderRow)=>{
    if(!folder&&(!courseId||!programmeId||!subjectFilter)){
      setError('Select a course, programme and subject before creating a folder');return;
    }
    setFolderEditor(folder??'new');
    setFolderName(folder?.name??'');
    setFolderColor(folder?.color??(folderColors[folders.length%folderColors.length]??'blue'));
    setOpenFolderOptions(null);
    setError('');
  };
  const saveFolder=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!folderEditor||folderBusy)return;
    const name=folderName.trim().replace(/\s+/g,' ');
    if(!name||name.length>100){setError('Folder name must be 1–100 characters');return;}
    const saved=folderEditor==='new'
      ?await folderAction(()=>folderApi.create(courseId,programmeId,subjectFilter,name,folderColor),'Folder created')
      :('kind' in folderEditor)
        ?await folderAction(()=>folderApi.copyFolder(folderEditor.folder.id,name),'Folder copied')
        :await folderAction(()=>folderApi.update(folderEditor,{name,color:folderColor}),'Folder updated');
    if(saved)setFolderEditor(null);
  };
  const pasteInto=()=>{
    if(!clipboard)return;
    const dest=folderFilter||null;
    if(clipboard.type==='file')void folderAction(()=>folderApi.copyDocument(clipboard.id,dest),'PDF copied into selected folder');
    else {const source=folders.find(folder=>folder.id===clipboard.id);if(source){setFolderEditor({kind:'copy',folder:source});setFolderName(`${source.name} copy`);setFolderColor(source.color);}}
  };
  const rootDestination:MoveDestination={id:null,courseId,programmeId,subjectId:subjectFilter,locked:false};
  const dragSource=(row:DocumentRow):MoveSource=>({id:row.id,revision:row.revision,courseId:row.courseId,programmeId:row.programmeId,subjectId:row.subjectId,folderId:row.folderId??null,canManage:row.canManage,locked:row.locked||Boolean(folders.find(f=>f.id===row.folderId)?.locked)});
  const beginDrag=(event:DragEvent<HTMLElement>,row:DocumentRow)=>{
    const item=dragSource(row);
    if(!item.canManage||item.locked||folderBusy){event.preventDefault();return;}
    setDragItem(item);
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',row.title);
  };
  const dragOverTarget=(event:DragEvent<HTMLElement>,destination:MoveDestination)=>{
    if(!canMoveTo(dragItem,destination))return;
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    setDropTarget(destination.id??'root');
  };
  const dropOnTarget=(event:DragEvent<HTMLElement>,destination:MoveDestination)=>{
    if(!canMoveTo(dragItem,destination))return;
    event.preventDefault();
    const item=dragItem!;
    setDragItem(null);setDropTarget(null);
    void folderAction(()=>folderApi.organize(item.id,item.revision,{folderId:destination.id}), 'PDF moved successfully');
  };
  // The API supplies the authoritative programme context; the catalogue is a navigation aid only.
  const selectedCourse = formCourse || '';
  const courseProgrammes = programmesForCourse(liveProgrammes,formCourse);
  const selectedProgramme = selectedProgrammeInCourse(liveProgrammes,formCourse,formProgramme);
  const availablePlans = programmeContext?.plans ?? [];
  const availableSubjects = programmeContext?.subjects ?? [];
  useEffect(()=>{
    if(!modal||!formProgramme){setProgrammeContext(null);setProgrammeBusy(false);return;}
    let cancelled=false;
    setProgrammeBusy(true);setProgrammeContext(null);setProgrammeError('');
    void academicClient.getProgrammeContext(formProgramme).then(context=>{
      if(cancelled)return;
      if(context.courses.length!==1 || context.courses[0]?.id!==formCourse){
        setProgrammeError('The programme is not mapped to the selected course. Select the correct course.');
        setProgrammeContext(null);
        return;
      }
      setProgrammeContext(context);
      setFormSubject(previous=>context.subjects.some(s=>s.id===previous)?previous:context.subjects.length===1?context.subjects[0]!.id:'');
      setFormPlans(previous=>replaceId?previous.filter(id=>context.plans.some(plan=>plan.id===id)):
        context.plans.map(plan=>plan.id));
    }).catch(cause=>{if(!cancelled)setProgrammeError(cause instanceof Error?cause.message:'Unable to load mapping')})
      .finally(()=>{if(!cancelled)setProgrammeBusy(false)});
    return()=>{cancelled=true};
  },[modal,formCourse,formProgramme,replaceId]);
  const visibleProgrammes = programmesForCourse(liveProgrammes,courseId);
  const selectedReadiness = getProgrammeReadiness(selectedProgramme&&programmeContext
    ? {...selectedProgramme,locked:programmeContext.programme.locked}
    : selectedProgramme,availablePlans,availableSubjects);
  const canSubmit = !!file && !!title.trim() && !!selectedCourse && selectedReadiness.ready &&
    availableSubjects.some(s=>s.id===formSubject) && formPlans.length>0 &&
    formPlans.every(id=>availablePlans.some(p=>p.id===id)) && !catalogLoading && !catalogError && !programmeBusy && !!programmeContext?.canPublish && !programmeError && !actionBusy;
  // Keep validation visible even when the submit control is disabled.
  // A selected PDF alone does not authorize publication to student plans.
  const missingUploadDetails = [
    !selectedCourse ? 'automatically mapped course' : null,
    !selectedProgramme ? 'programme' : null,
    selectedProgramme && !selectedReadiness.ready ? 'approved mapping' : null,
    programmeBusy ? 'programme context' : null,
    !availableSubjects.some(s => s.id === formSubject) ? 'subject' : null,
    !formPlans.length ? 'at least one student plan' : null,
    !title.trim() ? 'document title' : null,
    !file ? 'PDF file' : null,
  ].filter((item): item is string => item !== null);

  const openUpload = (replacement?: DocumentRow) => {
    setReplaceId(replacement?.id);
    const defaultCourse=replacement?.courseId || courseId || '';
    setFormCourse(defaultCourse);
    setProgrammeContext(null);setProgrammeError('');
    setFormProgramme(replacement?.programmeId || (defaultCourse && programmeId ? programmeId : ''));
    setFormSubject(replacement?.subjectId || subjectFilter || '');
    setFormFolder(replacement?.folderId || folderFilter || '');
    setFormPlans(replacement?.planIds ?? []);
    setTitle(replacement?.title ?? '');
    setFile(null); setProgress(null); setFormError(''); setModal(true);
    void refreshCatalog();
    void documentApi.policy().then(policy=>setUploadPolicyBytes(policy.maxPdfBytes)).catch(()=>setUploadPolicyBytes(null));
  };
  const dismiss = () => {
    if (progress !== null && progress < 100) return;
    setModal(false);setFile(null);setProgress(null);setFormError('');
  };
  const submit = async () => {
    if (!canSubmit || !file || !selectedProgramme) {
      setFormError(selectedReadiness.message || 'Complete the material details, select a PDF and at least one eligible plan.'); return;
    }
    setActionBusy('upload');setFormError('');setProgress(0);
    const abort = new AbortController();controller.current = abort;
    try {
      const selection:UploadSelection = { title:title.trim(),courseId:selectedCourse,programmeId:formProgramme,subjectId:formSubject,folderId:formFolder||null,planIds:formPlans,mappingRevision:programmeContext?.programme.mappingRevision };
      await uploadPdf(selection,file,setProgress,abort.signal,replaceId);
      setModal(false);setNotice('PDF uploaded. We’re checking the file and preparing its pages. Choose “Publish when ready” from the file options to publish automatically after preparation.');
      setFile(null);setProgress(null);await refresh();
    } catch (cause) {
      setProgress(null);
      await refresh();
      setFormError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally { controller.current=null;setActionBusy(''); }
  };
  const setPublicationIntent = async (row:DocumentRow,enabled:boolean) => {
    if(!row.latestVersion)return;
    setActionBusy(row.id);setError('');setNotice('');
    try{
      await documentApi.publicationIntent(row.id,row.latestVersion.id,enabled);
      setNotice(enabled?'Publication scheduled. This PDF will be published automatically when its checks and page preparation finish.':'Automatic publication cancelled. You can publish manually when ready.');
      setOpenDocumentOptions(null);await refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to update automatic publication');}
    finally{setActionBusy('');}
  };
  const runAction = async (id:string, action:'publish'|'retry'|'delete'|'abort',versionId?:string) => {
    if (action==='delete' && !window.confirm('Remove this document from DocHub? A secure audit record and retained object version will remain.')) return;
    setActionBusy(id);setError('');setNotice('');
    try {
      if (action==='publish') await documentApi.publish(id);
      else if (action==='retry' && versionId) await documentApi.retry(id,versionId);
      else if (action==='delete') await documentApi.remove(id);
      else if (action==='abort' && versionId) await documentApi.abort(id,versionId);
      setNotice(action==='publish' ? 'Document published.' : action==='retry' ? 'Processing queued again.' : action==='abort' ? 'Upload cancelled.' : 'Document removed from the catalogue.');
      setOpenDocumentOptions(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed'); }
    finally {setActionBusy('');}
  };
  return <>
    <div className="a-titlebar"><div><h1>Uploads</h1><p>Course → Programme → Subject → Materials</p></div>
      <button className="a-btn primary" type="button" disabled={!canManage||!liveCourses.length || !!actionBusy || catalogLoading || !!catalogError} onClick={()=>openUpload()}><Upload size={16}/> Upload PDF</button>
    </div>
    {error && <p role="alert" className="upload-feedback upload-error"><AlertCircle size={16}/>{error}<button type="button" onClick={reloadAll}>Reload</button></p>}
    {catalogError && <p role="alert" className="upload-feedback upload-error"><AlertCircle size={16}/>Academic catalogue: {catalogError}<button type="button" onClick={()=>void refreshCatalog()}>Try again</button></p>}
    {catalogLoading && <p role="status" className="upload-feedback"><RefreshCw size={16}/>Updating courses, programmes, subjects and plans…</p>}
    {notice && <p role="status" className="upload-feedback"><CheckCircle2 size={16}/>{notice}</p>}
    <div className="a-bar">
      <label>Course <select aria-label="Course filter" value={courseId} onChange={e=>{setCourseId(e.target.value);setProgrammeId('');setSubjectFilter('');setFolderFilter('')}}><option value="">All courses</option>{liveCourses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Programme <select aria-label="Programme filter" value={programmeId} disabled={!courseId} onChange={e=>{setProgrammeId(e.target.value);setSubjectFilter('');setFolderFilter('')}}><option value="">{courseId?'All programmes':'Select course first'}</option>{visibleProgrammes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Subject <select value={subjectFilter} onChange={e=>{setSubjectFilter(e.target.value);setFolderFilter('')}} disabled={!programmeId}><option value="">All subjects</option>{folderSubjectOptions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="a-search"><Search size={16}/><input aria-label="Find uploaded documents" placeholder="Find materials" value={query} onChange={e=>setQuery(e.target.value)}/></label>

    </div>
    <ProgrammeCascadeStrip programmeId={programmeId} />
    {courseId&&programmeId&&subjectFilter&&<section className="a-panel upload-folder-panel" aria-label="Subject folders">
      <div className="upload-folder-heading">
        <div className="upload-folder-title"><strong>Subject folders</strong><span>Organize study materials by folder. Drag PDFs into a folder to move them.</span></div>
        <div className="a-actions">
          {clipboard&&<button className="a-btn upload-clipboard-button" type="button" onClick={pasteInto} disabled={folderBusy||!canManage}><ClipboardPaste size={15}/> Paste {clipboard.type==='folder'?'folder':'PDF'}</button>}
          <button className="a-btn upload-create-button" type="button" onClick={()=>openFolderEditor()} disabled={folderBusy||!canManage}><FolderPlus size={16}/> New folder</button>
        </div>
      </div>
      <div className="upload-folder-grid" aria-label="Folder destinations">
        <button type="button"
          className={`upload-folder-card upload-folder-root ${!folderFilter?'is-active':''} ${dropTarget==='root'?'is-drop-target':''}`}
          onDragOver={e=>dragOverTarget(e,rootDestination)} onDragLeave={()=>setDropTarget(null)} onDrop={e=>dropOnTarget(e,rootDestination)}
          onClick={()=>{setFolderFilter('');setOpenFolderOptions(null)}}>
          <span className="upload-folder-icon color-slate"><FolderOpen size={23}/></span>
          <span className="upload-folder-meta"><strong>All materials</strong><small>Subject root</small></span>
        </button>
        {folders.map(folder=>{
          const destination:MoveDestination={id:folder.id,courseId:folder.courseId,programmeId:folder.programmeId,subjectId:folder.subjectId,locked:folder.locked};
          return <div key={folder.id} className={`upload-folder-card ${folderFilter===folder.id?'is-active':''} ${dropTarget===folder.id?'is-drop-target':''} ${folder.locked?'is-locked':''}`}
            onDragOver={e=>dragOverTarget(e,destination)} onDragLeave={()=>setDropTarget(null)} onDrop={e=>dropOnTarget(e,destination)}>
            <button type="button" className="upload-folder-card-open" onClick={()=>{setFolderFilter(folder.id);setOpenFolderOptions(null)}}
              title={`Open ${folder.name}`}>
              <span className={`upload-folder-icon color-${folder.color??'blue'}`}><Folder size={23} fill="currentColor" fillOpacity={0.18}/></span>
              <span className="upload-folder-meta"><strong title={folder.name}>{folder.name}</strong><small>{folder._count.documents} {folder._count.documents===1?'PDF':'PDFs'}{folder.locked?' · Locked':folder.hidden?' · Hidden':''}</small></span>
            </button>
            <UploadsActionMenu label={`Folder options: ${folder.name}`} open={openFolderOptions===folder.id}
              onOpenChange={next=>{setOpenFolderOptions(next?folder.id:null);setOpenDocumentOptions(null)}}>
              <div className="upload-menu-heading">{folder.name}</div>
              <button role="menuitem" type="button" disabled={folderBusy||folder.locked} onClick={()=>openFolderEditor(folder)}><Pencil size={16}/> Rename & color</button>
              <button role="menuitemcheckbox" aria-checked={folder.hidden} type="button" disabled={folderBusy||folder.locked} onClick={()=>void folderAction(()=>folderApi.update(folder,{hidden:!folder.hidden}))}>{folder.hidden?<EyeIcon size={16}/>:<EyeOff size={16}/>} {folder.hidden?'Make visible':'Hide folder'} {folder.hidden&&<Check size={15} className="upload-menu-check"/>}</button>
              <button role="menuitemcheckbox" aria-checked={folder.locked} type="button" disabled={folderBusy||!canManage} onClick={()=>void folderAction(()=>folderApi.update(folder,{locked:!folder.locked}))}>{folder.locked?<Unlock size={16}/>:<Lock size={16}/>} {folder.locked?'Unlock folder':'Lock folder'} {folder.locked&&<Check size={15} className="upload-menu-check"/>}</button>
              <div className="upload-menu-separator" role="separator" />
              <div className="upload-menu-label">Student permissions</div>
              <button role="menuitemcheckbox" aria-checked={folder.allowDownload} type="button" disabled={folderBusy||folder.locked} onClick={()=>void folderAction(()=>folderApi.update(folder,{allowDownload:!folder.allowDownload}))}><Download size={16}/> Allow download <span className="upload-menu-status">{folder.allowDownload?'On':'Off'}</span></button>
              <button role="menuitemcheckbox" aria-checked={folder.allowPrint} type="button" disabled={folderBusy||folder.locked} onClick={()=>void folderAction(()=>folderApi.update(folder,{allowPrint:!folder.allowPrint}))}><Printer size={16}/> Allow print <span className="upload-menu-status">{folder.allowPrint?'On':'Off'}</span></button>
              <div className="upload-menu-separator" role="separator" />
              <button role="menuitem" type="button" disabled={folderBusy||folder.locked} onClick={()=>{setClipboard({type:'folder',id:folder.id,title:folder.name});setOpenFolderOptions(null)}}><Copy size={16}/> Copy folder</button>
            </UploadsActionMenu>
          </div>;
        })}
      </div>
      {dragItem&&<p className="upload-drag-instruction" role="status"><MoveRight size={16}/> Drop the PDF onto an unlocked folder, or onto All materials to move it to the subject root.</p>}
      {clipboard&&<p className="upload-folder-clipboard" role="status">Copied {clipboard.type}: <strong>{clipboard.title}</strong>. Choose a destination and click Paste.</p>}
    </section>}
    <section className="a-panel a-file-panel"><div className="a-table-wrap"><table>
      <thead><tr><th>File</th><th>Programme</th><th>Subject</th><th>Pages</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{rows.map(row=>{
        const current = row.latestVersion;
        const isPublished = row.status === 'PUBLISHED';
        const pendingReplacement = isPublished && current && current.state !== 'PUBLISHED';
        const preparingPages = current?.state === 'READY' && !current.canPublish;
        const versionStatus = preparingPages ? 'Preparing PDF pages' : statusLabel[current?.state ?? row.status] ?? row.status;
        const statusText = isPublished ? (pendingReplacement ? `Published · replacement ${versionStatus.toLowerCase()}` : 'Published') : versionStatus;
        return <tr key={row.id}>
          <td><div className="upload-file-title" draggable={row.canManage&&!row.locked&&!folderBusy&&!active.has(current?.state??'')}
              onDragStart={e=>beginDrag(e,row)} onDragEnd={()=>{setDragItem(null);setDropTarget(null)}}
              title={row.canManage&&!row.locked?'Drag into a folder to move this PDF':undefined}>
            <GripVertical size={15} className="upload-drag-handle" aria-hidden="true"/>
            <FileText size={17} className="a-file-icon"/> <span><strong>{row.title}</strong><small>{bytesLabel(current?.sizeBytes)} · Version {current?.number ?? 1}</small></span>
          </div></td>
          <td>{liveProgrammes.find(p=>p.id===row.programmeId)?.name ?? '—'}<small>{liveCourses.find(c=>c.id===row.courseId)?.name??'Course'}</small></td>
          <td>{liveSubjects.find(s=>s.id===row.subjectId)?.name ?? '—'}{row.folderId&&<small><FolderOpen size={12}/> {folders.find(f=>f.id===row.folderId)?.name??'Folder'}</small>}</td>
          <td>{current?.pageCount ?? '—'}</td><td><span className={`upload-status status-${preparingPages ? 'PROCESSING' : current?.state ?? row.status}`}>{statusText}</span>{current?.publishWhenReady ? <small>{current.state==='FAILED'||current.state==='QUARANTINED'?'Automatic publication is blocked by a processing failure.':'Will publish automatically when preparation finishes.'}</small> : preparingPages && <small>Choose “Publish when ready” in file options, or publish manually after preparation.</small>}{current?.publicationFailure && <small className="upload-failure">Automatic publication paused: {current.publicationFailure}</small>}{current?.failureReason && current.state === 'FAILED' && <small className="upload-failure" title={current.failureReason}>{current.failureReason}</small>}</td>
          <td><div className="upload-actions">
            <UploadsActionMenu label={`Options for ${row.title}`} open={openDocumentOptions===row.id}
              onOpenChange={next=>{setOpenDocumentOptions(next?row.id:null);setOpenFolderOptions(null)}}>
              <div className="upload-menu-heading" title={row.title}>{row.title}</div>
              {(row.status==='PUBLISHED'||current?.state==='READY')&&<button role="menuitem" type="button" onClick={()=>{setPreview({id:row.id,title:row.title});setOpenDocumentOptions(null)}}><Eye size={16}/> Preview</button>}
              {row.canManage&&current?.state==='UPLOADING'&&<button role="menuitem" disabled={!!actionBusy} onClick={()=>void runAction(row.id,'abort',current.id)}>Cancel upload</button>}
              {row.canManage&&current&&(current.publishWhenReady||['UPLOADING','QUEUED','PROCESSING','READY'].includes(current.state))&&(!current.canPublish||current.publishWhenReady)&&<button role="menuitemcheckbox" aria-checked={current.publishWhenReady} disabled={!!actionBusy} onClick={()=>void setPublicationIntent(row,!current.publishWhenReady)}><CheckCircle2 size={16}/> {current.publishWhenReady?'Cancel automatic publication':'Publish when ready'}</button>}
              {row.canManage&&current?.state==='READY'&&<button role="menuitem" disabled={!!actionBusy || !current.canPublish} onClick={()=>void runAction(row.id,'publish')}><CheckCircle2 size={16}/> Publish</button>}
              {row.canManage&&current?.state==='FAILED'&&<button role="menuitem" disabled={!!actionBusy} onClick={()=>void runAction(row.id,'retry',current.id)}><RotateCcw size={16}/> Retry</button>}
              {row.canManage&&['PUBLISHED','READY','FAILED'].includes(current?.state??'')&&<button role="menuitem" disabled={!!actionBusy} onClick={()=>{openUpload(row);setOpenDocumentOptions(null)}}><Upload size={16}/> Replace PDF</button>}
              {row.canManage&&row.status==='PUBLISHED'&&<>
                <div className="upload-menu-separator" role="separator"/>
                <div className="upload-menu-label">Student permissions</div>
                <button role="menuitemcheckbox" aria-checked={row.allowDownload} disabled={folderBusy||row.locked} onClick={()=>changeDocumentPermission(row,'allowDownload')}><Download size={16}/> Allow download <span className="upload-menu-status">{row.allowDownload?'On':'Off'}</span></button>
                <button role="menuitemcheckbox" aria-checked={row.allowPrint} disabled={folderBusy||row.locked} onClick={()=>changeDocumentPermission(row,'allowPrint')}><Printer size={16}/> Allow print <span className="upload-menu-status">{row.allowPrint?'On':'Off'}</span></button>
                <div className="upload-menu-separator" role="separator"/>
                <button role="menuitem" disabled={folderBusy||row.locked} onClick={()=>{setClipboard({type:'file',id:row.id,title:row.title});setOpenDocumentOptions(null)}}><Copy size={16}/> Copy PDF</button>
                <button role="menuitemcheckbox" aria-checked={row.hidden} disabled={folderBusy||row.locked} onClick={()=>void folderAction(()=>folderApi.organize(row.id,row.revision,{hidden:!row.hidden}))}>{row.hidden?<EyeIcon size={16}/>:<EyeOff size={16}/>} {row.hidden?'Make visible':'Hide PDF'}</button>
                <button role="menuitemcheckbox" aria-checked={row.locked} disabled={folderBusy||!canManage} onClick={()=>void folderAction(()=>folderApi.organize(row.id,row.revision,{locked:!row.locked}))}>{row.locked?<Unlock size={16}/>:<Lock size={16}/>} {row.locked?'Unlock PDF':'Lock PDF'}</button>
                {courseId&&programmeId&&subjectFilter&&<label className="upload-menu-move"><MoveRight size={16}/> Move to
                  <select aria-label={`Move ${row.title} to folder`} disabled={folderBusy||row.locked} value={row.folderId||''}
                    onChange={e=>void folderAction(()=>folderApi.organize(row.id,row.revision,{folderId:e.target.value||null}),'PDF moved successfully')}>
                    <option value="">Subject root</option>{folders.map(f=><option key={f.id} disabled={f.locked} value={f.id}>{f.name}</option>)}
                  </select></label>}
              </>}
              {row.canManage&&!active.has(current?.state??'')&&<><div className="upload-menu-separator" role="separator"/><button role="menuitem" className="is-danger" disabled={!!actionBusy} onClick={()=>void runAction(row.id,'delete')}><Trash2 size={16}/> Delete</button></>}
              <p className="upload-menu-footnote">Sharing is disabled for students.</p>
            </UploadsActionMenu>
          </div></td>
        </tr>;
      })}</tbody></table></div>
      {loading && <p role="status" className="upload-empty">Loading documents…</p>}
      {!loading && !error && !rows.length && <p className="upload-empty">No documents found. Choose an approved mapping and upload a PDF.</p>}
      {cursor && <div className="upload-load-more"><button type="button" className="a-btn" onClick={()=>void refresh(true,cursor)} disabled={loading}>Load more</button></div>}
    </section>
    {folderEditor&&<div className="upload-folder-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!folderBusy)setFolderEditor(null)}}>
      <form className="upload-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-editor-title" onSubmit={e=>void saveFolder(e)}
        onKeyDown={event=>{
          if(event.key==='Escape'&&!folderBusy){event.preventDefault();setFolderEditor(null);}
          if(event.key==='Tab'){
            const nodes=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
            if(!nodes.length)return;
            if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes[nodes.length-1]?.focus();}
            if(!event.shiftKey&&document.activeElement===nodes[nodes.length-1]){event.preventDefault();nodes[0]?.focus();}
          }
        }}>
        <div className="upload-folder-dialog-heading"><span className={`upload-folder-icon color-${folderColor}`}><Folder size={25} fill="currentColor" fillOpacity={0.18}/></span>
          <div><h2 id="folder-editor-title">{folderEditor==='new'?'Create folder':typeof folderEditor==='object'&&'kind' in folderEditor?'Copy folder':'Edit folder'}</h2><p>A dedicated space for your learning materials.</p></div>
          <button className="upload-icon-dismiss" type="button" aria-label="Close folder editor" disabled={folderBusy||!canManage} onClick={()=>setFolderEditor(null)}><X size={18}/></button>
        </div>
        <div className={`upload-folder-live-preview color-${folderColor}`}><span><Folder size={38} fill="currentColor" fillOpacity={0.18}/></span><div><strong>{folderName.trim()||'Untitled folder'}</strong><small>{liveCourses.find(c=>c.id===courseId)?.name} / {liveProgrammes.find(p=>p.id===programmeId)?.name} / {liveSubjects.find(s=>s.id===subjectFilter)?.name}</small></div></div>
        <label className="upload-folder-input-label"><span className="upload-folder-label-row"><span>Folder name</span><small>{folderName.length}/100</small></span>
          <input autoFocus maxLength={100} required value={folderName} placeholder="e.g. Revision Notes 2026" onChange={e=>setFolderName(e.target.value)}/>
        </label>
        {!(typeof folderEditor==='object'&&'kind' in folderEditor)&&<div className="upload-folder-colors"><div className="upload-folder-input-label"><Palette size={15}/> Folder colour</div>
          <div className="upload-folder-color-list" role="group" aria-label="Folder colour">
            {folderColors.map(color=><button type="button" className={`upload-folder-color-choice color-${color} ${folderColor===color?'is-selected':''}`}
              key={color} onClick={()=>setFolderColor(color)} aria-label={`${color} folder`} aria-pressed={folderColor===color}><span className="upload-folder-color-swatch"/>{folderColor===color&&<Check size={14}/>}</button>)}
          </div>
        </div>}
        {error&&<p className="upload-feedback upload-error" role="alert"><AlertCircle size={15}/>{error}</p>}
        <div className="upload-folder-dialog-footer"><button className="a-btn" disabled={folderBusy||!canManage} type="button" onClick={()=>setFolderEditor(null)}>Cancel</button>
          <button className="a-btn primary" disabled={folderBusy||!folderName.trim()} type="submit">{folderBusy?<LoaderCircle className="upload-spinning" size={16}/>:<Check size={16}/>}{folderEditor==='new'?'Create folder':typeof folderEditor==='object'&&'kind' in folderEditor?'Copy folder':'Save changes'}</button></div>
      </form>
    </div>}
    {preview && <DocumentPreview documentId={preview.id} title={preview.title} onClose={()=>setPreview(null)} />}
    {modal && <div className="a-modal-shade" onMouseDown={e=>{if(e.currentTarget===e.target)dismiss()}}>
      <div className="a-modal upload-drawer" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
        <button className="a-modal-x" type="button" disabled={actionBusy==='upload'} onClick={dismiss} aria-label="Close upload form"><X size={18}/></button>
        <div className="upload-drawer-heading">
          <span className="upload-drawer-icon"><Upload size={20}/></span>
          <div><h2 id="upload-modal-title">{replaceId ? 'Replace document' : 'Upload study material'}</h2>
            <p>PDF · Secure storage · Programme-based access</p></div>
        </div>
        {catalogLoading && <p role="status" className="upload-inline-notice"><RefreshCw size={15}/> Loading the latest academic mappings…</p>}
        {catalogError && <div role="alert" className="upload-inline-notice upload-blocked"><AlertCircle size={17}/><span>Unable to retrieve academic mappings: {catalogError}</span><button type="button" onClick={()=>void refreshCatalog()}>Retry</button></div>}
        <div className="upload-section-title"><span>1</span><strong>Academic location</strong></div>
        <div className="upload-field-row">
          <label className="upload-field">Course
            <select aria-label="Upload course" disabled={!!replaceId||!!actionBusy||catalogLoading} value={formCourse} onChange={e=>{setFormCourse(e.target.value);setFormProgramme('');setProgrammeContext(null);setProgrammeError('');setFormSubject('');setFormFolder('');setFormPlans([]);setFormError('')}}>
              <option value="">Select course</option>
              {liveCourses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="upload-field">Programme
            <select aria-label="Upload programme" disabled={!formCourse||!!replaceId||!!actionBusy||catalogLoading} value={formProgramme} onChange={e=>{setFormProgramme(e.target.value);setProgrammeContext(null);setProgrammeError('');setFormSubject('');setFormFolder('');setFormPlans([]);setFormError('')}}>
              <option value="">{formCourse?'Select programme':'Select course first'}</option>
              {courseProgrammes.map(p=><option key={p.id} value={p.id}>{p.name}{p.locked ? '' : ' — approval required'}</option>)}
            </select>
          </label>
        </div>
        {programmeBusy&&<div role="status" className="upload-inline-notice">Resolving mapped course, subjects and plans…</div>}
        {programmeError&&<div role="alert" className="upload-inline-notice upload-blocked">{programmeError}</div>}
        {formCourse && !catalogLoading && !catalogError && !courseProgrammes.length && <div className="upload-inline-notice upload-blocked" role="status">
          <LockKeyhole size={17}/><span>No programmes exist for this course. Create and approve a programme in Academic Mapping first.</span>
          <button type="button" onClick={onOpenAcademicMapping}>Open mapping <ArrowRight size={13}/></button>
        </div>}
        {selectedProgramme && !selectedReadiness.ready && <div className="upload-inline-notice upload-blocked" role="status">
          <LockKeyhole size={17}/><span><strong>{selectedProgramme.name}:</strong> {selectedReadiness.message}</span>
          <button type="button" onClick={onOpenAcademicMapping}>Open mapping <ArrowRight size={13}/></button>
        </div>}
        {selectedProgramme && selectedReadiness.ready && programmeContext?.canPublish && <div className="upload-inline-notice upload-approved" role="status"><CheckCircle2 size={16}/> Approved mapping · {availableSubjects.length} subjects · {availablePlans.length} plans</div>}
        <div className="upload-field-row">
          <label className="upload-field">Subject
            <select disabled={!!replaceId || !!actionBusy || !selectedReadiness.ready} value={formSubject} onChange={e=>{setFormSubject(e.target.value);setFormFolder('');setFormError('')}}>
              <option value="">Select mapped subject</option>{availableSubjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        {formSubject&&<label className="upload-field">Folder (optional)
          <select disabled={!!replaceId||!!actionBusy} value={formFolder} onChange={e=>setFormFolder(e.target.value)}>
            <option value="">Subject root</option>{modalFolders.map(f=><option key={f.id} disabled={f.locked} value={f.id}>{f.name}</option>)}
          </select>
        </label>}
        <div className="upload-section-title"><span>2</span><strong>Student access</strong></div>
        <div className="upload-field-help">The mapped plans for this course and programme are checked by default. Check or uncheck plans to control the audience; active student subscriptions are enforced separately.</div>
        <div className="a-actions"><button className="a-btn" type="button" disabled={!!replaceId||!!actionBusy||!selectedReadiness.ready} onClick={()=>setFormPlans(availablePlans.map(p=>p.id))}>Check all</button><button className="a-btn" type="button" disabled={!!replaceId||!!actionBusy||!selectedReadiness.ready} onClick={()=>setFormPlans([])}>Uncheck all</button><span className="upload-field-help">{formPlans.length} of {availablePlans.length} selected</span></div>
        <div className="upload-plan-grid" role="group" aria-label="Plans authorized to access this material">
          {availablePlans.map(p=><label className="upload-plan-option" key={p.id}>
            <input type="checkbox" disabled={!!replaceId || !!actionBusy || !selectedReadiness.ready} checked={formPlans.includes(p.id)} onChange={e=>{setFormPlans(a=>e.target.checked?[...a,p.id]:a.filter(x=>x!==p.id));setFormError('')}}/>
            <span>{p.name}</span>
          </label>)}
          {!availablePlans.length && <div className="upload-muted">{!selectedProgramme ? 'Select course and programme to view plans.' : 'No plans have been mapped to this programme.'}</div>}
        </div>
        <div className="upload-section-title"><span>3</span><strong>Document</strong></div>
        <label className="upload-field">Document title
          <input disabled={!!replaceId || !!actionBusy} value={title} maxLength={240} placeholder="e.g. Anatomy — Upper Limb Notes" onChange={e=>{setTitle(e.target.value);setFormError('')}}/>
        </label>
        <div className="upload-file-drop" onDragEnter={e=>{e.preventDefault();if(!actionBusy)setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);if(!actionBusy)setChosenFile(e.dataTransfer.files[0]??null)}} data-dragging={dragging}>
          <label className="upload-file-control" htmlFor="upload-pdf-input">
            <input id="upload-pdf-input" className="upload-native-file" type="file" accept=".pdf,application/pdf" disabled={!!actionBusy} onChange={e=>setChosenFile(e.target.files?.[0]??null)}/>
            <span className="upload-file-symbol"><FolderOpen size={24}/></span>
            <strong>{file ? file.name : 'Choose a PDF or drag it here'}</strong>
            <span className="upload-file-subtitle">{file ? `${bytesLabel(String(file.size))} · Ready to transfer` : 'Private, encrypted storage · PDF only'}</span>
            <span className="upload-file-button">{file ? 'Change PDF' : 'Browse files'}</span>
          </label>
        </div>
        {uploadPolicyBytes !== null && <div className="upload-field-help">Maximum PDF size: {bytesLabel(String(uploadPolicyBytes))}.</div>}
        {progress !== null && <div className="upload-progress" role="status"><label>Uploading securely · {progress}%</label><progress max={100} value={progress}/></div>}
        {formError && <p className="upload-feedback upload-error" role="alert"><AlertCircle size={16}/>{formError}</p>}
        <div className="upload-submit-footer">
          {missingUploadDetails.length > 0 && !catalogLoading && !catalogError && !actionBusy &&
            <p className="upload-required-hint" role="status"><AlertCircle size={15}/>
              <span>To start upload, select: {missingUploadDetails.join(', ')}.</span>
            </p>}
          <div className="upload-footer-note"><LockKeyhole size={14}/> Students can access the PDF only after processing and publication.</div>
          <div className="a-actions"><button className="a-btn" type="button" onClick={()=>controller.current ? controller.current.abort() : dismiss()}>{actionBusy==='upload'?'Cancel upload':'Cancel'}</button>
            <button className="a-btn primary" type="button" disabled={!canSubmit} onClick={()=>void submit()}><Upload size={15}/>{actionBusy==='upload'?'Uploading…':replaceId?'Replace PDF':'Start upload'}</button></div>
        </div>
      </div>
    </div>}
  </>;
}
