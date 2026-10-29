import {visibleWatermarkedImage,defaultWatermark,type PdfWatermark as Watermark} from './pdf-watermark';
import {useCallback,useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent,type TouchEvent as ReactTouchEvent} from 'react';
import {BookCheck,Check,CheckCircle2,ChevronLeft,ChevronRight,Download,Eraser,FileText,Highlighter,Menu,Minus,MousePointer2,PenLine,Printer,RefreshCw,RotateCcw,ShieldCheck,X,ZoomIn} from 'lucide-react';
import {authorizedBlobRequest,authorizedPdfRequest} from './auth-client';
import {createPreviewPageLoader} from './preview-page-loader';
import {documentApi,type StudyStroke,type StudyPage,type PreviewDelivery} from './uploads-client';
import './student-study-page-nav.css';

const MAX_ZOOM=2.5,MIN_ZOOM=.55;
type Mode='move'|'pen'|'highlighter'|'eraser';
type Fit='page'|'width'|'actual';
type Props={initialPage?:number;watermark?:Watermark;documentId:string;title:string;versionId:string;pageCount:number;allowDownload:boolean;allowPrint:boolean;delivery?:PreviewDelivery;onClose:()=>void;onRenew:()=>void};
const palette=['#174fa4','#c43856','#187e69','#292d3b','#da9238'];
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));


/** Defense in depth only: the authoritative API must deliver student-watermarked
 * assets itself. In-browser compositing cannot stop DevTools or network capture. */


function ReaderThumbnail({id,versionId,page,selected,read,hasInk,onSelect,onRead,disabled,email,loadPage,watermark}:{watermark:Watermark;loadPage:(page:number)=>Promise<Blob>;id:string;versionId:string;page:number;selected:boolean;read:boolean;hasInk:boolean;onSelect:()=>void;onRead:()=>void;disabled:boolean;email:string}){
 const element=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false);
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{
  const node=element.current;
  if(!node)return;
  const observer=new IntersectionObserver(entries=>{setVisible(entries.some(e=>e.isIntersecting))},{root:node.closest('.study-thumb-scroll'),rootMargin:'220px'});
  observer.observe(node);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!visible||!email.includes('@')){setUrl(null);return;}
  let active=true,objectUrl:string|null=null;
  void loadPage(page).then(blob=>visibleWatermarkedImage(blob,email,watermark)).then(marked=>{
   objectUrl=URL.createObjectURL(marked);
   if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
  }).catch(()=>{});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[visible,id,versionId,page,email,loadPage,watermark]);
 useEffect(()=>{if(selected)element.current?.scrollIntoView({block:'nearest'})},[selected]);
 return <div ref={element} className={`study-thumbnail ${selected?'is-active':''}`}>
  <button className="study-thumb-image" onClick={onSelect} onContextMenu={event=>event.preventDefault()} aria-current={selected?'page':undefined} title={`Open page ${page}`}>
   {url?<img src={url} alt={`PDF page ${page} preview`} draggable={false}/>:<span className="study-thumb-placeholder"><FileText size={22}/></span>}
   {hasInk&&<span className="study-thumb-ink" title="Contains notes"><PenLine size={12}/></span>}
  </button>
  <div className="study-thumb-bottom"><span>Page {page}</span><button type="button" className={`study-read-toggle ${read?'is-read':''}`} onClick={onRead} disabled={disabled} aria-label={`${read?'Mark unread':'Mark as read'} page ${page}`} aria-pressed={read}><Check size={14}/><span>{read?'Read':'Mark read'}</span></button></div>
 </div>;
}

export default function StudentStudyViewer({documentId,title,versionId,pageCount,allowDownload,allowPrint,delivery,watermark=defaultWatermark,initialPage=1,onClose,onRenew}:Props){
 const loadPage=useMemo(()=>createPreviewPageLoader(documentId,versionId,delivery,{read:documentApi.read,fallback:authorizedBlobRequest}),[documentId,versionId,delivery]);
 const [page,setPage]=useState(initialPage);
 const [showRail,setShowRail]=useState(()=>window.innerWidth>700);
 const [mode,setMode]=useState<Mode>('move');
 const [fit,setFit]=useState<Fit>('width');
 const [zoom,setZoom]=useState(1);
 const [color,setColor]=useState('#174fa4');
 const [summary,setSummary]=useState<Record<number,{isRead:boolean;hasInk:boolean}>>({});
 const [email,setEmail]=useState('');
 const [ink,setInk]=useState<StudyStroke[]>([]);
 const inkRef=useRef<StudyStroke[]>([]);
 const [draft,setDraft]=useState<StudyStroke|null>(null);
 const draftRef=useRef<StudyStroke|null>(null);
 const revisionRef=useRef(0);
 const [pageReady,setPageReady]=useState(false);
 const [pageUrl,setPageUrl]=useState<string|null>(null);
 const [pageLoading,setPageLoading]=useState(true);
 const [error,setError]=useState('');
 const [summaryError,setSummaryError]=useState('');
 const [notesError,setNotesError]=useState('');
 const [previewError,setPreviewError]=useState('');
 const [saving,setSaving]=useState(false);
 const busyRef=useRef(false);
 const [printing,setPrinting]=useState(false);
 const viewportRef=useRef<HTMLDivElement>(null);
 const svgRef=useRef<SVGSVGElement>(null);
 const [bounds,setBounds]=useState({width:800,height:700});
 const [natural,setNatural]=useState({width:800,height:1100});
 const swipeRef=useRef<{x:number;y:number}|null>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const readCount=Object.values(summary).filter(p=>p.isRead).length;
 const percent=Math.round(readCount/pageCount*100);
 // All validated document pages must be addressable.
 const safePageCount=pageCount;
 // Do not create thousands of thumbnail components/image observers.
 const thumbStart=Math.max(1,Math.min(page-20,safePageCount-40));
 const thumbEnd=Math.min(safePageCount,thumbStart+40);
 const [jumpText,setJumpText]=useState('1');
 useEffect(()=>setJumpText(String(page)),[page]);
 const jumpToPage=()=>{
  const value=Number(jumpText);
  if(jumpText.trim()&&Number.isSafeInteger(value)&&value>=1&&value<=safePageCount&&!busyRef.current){
   setPage(value);setError('');
  }else setJumpText(String(page));
 };
 const watermarkReady=email.includes('@');
 const visibleError=error||summaryError||notesError||previewError;

 const reloadStudyPage=useCallback(async(target:number)=>{
  const response:StudyPage=await documentApi.studyPage(documentId,versionId,target);
  if(target!==page)return;
  inkRef.current=response.strokes;setInk(response.strokes);revisionRef.current=response.revision;
  setSummary(existing=>({...existing,[target]:{isRead:response.isRead,hasInk:response.strokes.length>0}}));
  setPageReady(true);
 },[documentId,versionId,page]);
 useEffect(()=>{
  let active=true;
  setSummaryError('');
  void documentApi.studySummary(documentId,versionId).then(result=>{
   if(active){setEmail(result.email);setSummary(Object.fromEntries(result.pages.map(p=>[p.page,{isRead:p.isRead,hasInk:p.hasInk}])));}
  }).catch(cause=>{if(active)setSummaryError(`Study profile unavailable: ${cause instanceof Error?cause.message:'Request failed'}`)});
  return()=>{active=false};
 },[documentId,versionId]);
 useEffect(()=>{
  let active=true;
  setPageReady(false);setPageLoading(true);setPageUrl(null);setError('');setNotesError('');setPreviewError('');
  setInk([]);inkRef.current=[];setDraft(null);draftRef.current=null;revisionRef.current=0;
  let objectUrl:string|null=null;
  // Never make authorized image rendering depend on the availability of the
  // independent annotation service. Writing remains disabled until notes load.
  void documentApi.studyPage(documentId,versionId,page).then(study=>{
   if(active){setInk(study.strokes);inkRef.current=study.strokes;revisionRef.current=study.revision;setPageReady(true);setSummary(existing=>({...existing,[page]:{isRead:study.isRead,hasInk:study.strokes.length>0}}));}
  }).catch(cause=>{if(active)setNotesError(`Page annotations unavailable: ${cause instanceof Error?cause.message:'Request failed'}`)});
  if(email.includes('@')){
   void loadPage(page).then(blob=>visibleWatermarkedImage(blob,email,watermark)).then(marked=>{
    objectUrl=URL.createObjectURL(marked);
    if(active)setPageUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
   }).catch(cause=>{if(active)setPreviewError(`Protected page image unavailable: ${cause instanceof Error?cause.message:'Request failed'}`)}).finally(()=>{if(active)setPageLoading(false)});
  }else{setPageLoading(false);}
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[documentId,versionId,page,email,loadPage,watermark]);
 useEffect(()=>{
  const node=viewportRef.current;if(!node)return;
  const observer=new ResizeObserver(()=>setBounds({width:node.clientWidth,height:node.clientHeight}));
  observer.observe(node);setBounds({width:node.clientWidth,height:node.clientHeight});
  return()=>observer.disconnect();
 },[showRail]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.stopPropagation();closeRef.current();return;}
   if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)return;
   if(busyRef.current)return;
   if(event.key==='ArrowLeft'){event.preventDefault();setPage(p=>Math.max(1,p-1));}
   if(event.key==='ArrowRight'){event.preventDefault();setPage(p=>Math.min(safePageCount,p+1));}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[safePageCount]);
 const mutationError=(cause:unknown)=>{setError(cause instanceof Error?cause.message:'Could not save study changes')};
 const updatePageSummary=(target:number,fields:Partial<{isRead:boolean;hasInk:boolean}>)=>setSummary(old=>({...old,[target]:{isRead:old[target]?.isRead??false,hasInk:old[target]?.hasInk??false,...fields}}));
 const markRead=async(target:number)=>{
  if(busyRef.current)return;
  busyRef.current=true;setSaving(true);setError('');
  try{
   const value=!(summary[target]?.isRead??false);
   const updated=await documentApi.markStudyPage(documentId,versionId,target,value);
   updatePageSummary(target,{isRead:updated.isRead});
   if(target===page)revisionRef.current=updated.revision;
  }catch(cause){mutationError(cause)}finally{busyRef.current=false;setSaving(false)}
 };
 const saveInk=async(next:StudyStroke[])=>{
  if(busyRef.current)return;
  busyRef.current=true;setSaving(true);setError('');
  inkRef.current=next;setInk(next);
  try{
   const updated=await documentApi.studyInk(documentId,versionId,page,revisionRef.current,next);
   revisionRef.current=updated.revision;updatePageSummary(page,{hasInk:next.length>0});
  }catch(cause){
   mutationError(cause);
   try{await reloadStudyPage(page)}catch{}
  }finally{busyRef.current=false;setSaving(false)}
 };
 const point=(event:ReactPointerEvent<SVGSVGElement>):[number,number]=>{
  const rect=svgRef.current!.getBoundingClientRect();
  return [Math.round(clamp((event.clientX-rect.left)/rect.width*1000,0,1000)),Math.round(clamp((event.clientY-rect.top)/rect.height*1000,0,1000))];
 };
 const eraseAt=(target:[number,number])=>{
  const distance=(a:[number,number],b:[number,number])=>{
   const vx=b[0]-a[0],vy=b[1]-a[1];const dot=(target[0]-a[0])*vx+(target[1]-a[1])*vy;
   const ratio=clamp(dot/(vx*vx+vy*vy||1),0,1);
   return Math.hypot(target[0]-(a[0]+vx*ratio),target[1]-(a[1]+vy*ratio));
  };
  const index=inkRef.current.findIndex(s=>s.points.some((p,i)=>distance(p,s.points[Math.min(i+1,s.points.length-1)]!)<=Math.max(18,s.width*2)));
  if(index>=0)void saveInk(inkRef.current.filter((_,i)=>i!==index));
 };
 const pointerDown=(event:ReactPointerEvent<SVGSVGElement>)=>{
  if(!pageReady||pageLoading||busyRef.current||mode==='move'||event.button!==0)return;
  event.preventDefault();const location=point(event);
  if(mode==='eraser'){eraseAt(location);return;}
  svgRef.current?.setPointerCapture(event.pointerId);
  const stroke:StudyStroke={id:crypto.randomUUID().replace(/-/g,''),kind:mode,color,width:mode==='highlighter'?17:4,points:[location]};
  draftRef.current=stroke;setDraft(stroke);
 };
 const pointerMove=(event:ReactPointerEvent<SVGSVGElement>)=>{
  if(!draftRef.current||mode==='move')return;
  event.preventDefault();const next=point(event),prev=draftRef.current.points.at(-1)!;
  if(Math.hypot(next[0]-prev[0],next[1]-prev[1])<2)return;
  const updated={...draftRef.current,points:[...draftRef.current.points,next]};
  draftRef.current=updated;setDraft(updated);
 };
 const pointerEnd=(event:ReactPointerEvent<SVGSVGElement>)=>{
  if(!draftRef.current)return;
  event.preventDefault();const value=draftRef.current;draftRef.current=null;setDraft(null);
  try{svgRef.current?.releasePointerCapture(event.pointerId)}catch{}
  void saveInk([...inkRef.current,value]);
 };
 const swipeStart=(e:ReactTouchEvent)=>{if(mode==='move'&&zoom<=1.05&&e.touches.length===1)swipeRef.current={x:e.touches[0]!.clientX,y:e.touches[0]!.clientY}};
 const swipeEnd=(e:ReactTouchEvent)=>{
  if(zoom>1.05||!swipeRef.current||mode!=='move'||busyRef.current||e.changedTouches.length!==1)return;
  const dx=e.changedTouches[0]!.clientX-swipeRef.current.x,dy=e.changedTouches[0]!.clientY-swipeRef.current.y;
  swipeRef.current=null;
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5)setPage(n=>clamp(n+(dx<0?1:-1),1,safePageCount));
 };
 const ratio=natural.width/Math.max(1,natural.height);
 const availableWidth=Math.max(220,bounds.width-(window.innerWidth<=760?16:44)),availableHeight=Math.max(240,bounds.height-36);
 const baseWidth=fit==='page'?Math.min(availableWidth,availableHeight*ratio):fit==='width'?availableWidth:natural.width;
 const paperWidth=Math.round(baseWidth*zoom),paperHeight=Math.round(paperWidth/ratio);
 const go=(delta:number)=>{if(!busyRef.current){setPage(n=>clamp(n+delta,1,safePageCount));setError('')}};
 const personalizedPdf=async(purpose:'download'|'print')=>{
  if(printing||!watermarkReady){if(!watermarkReady)setError('A verified student email is required for PDF export.');return;}
  // Open the print tab inside the user click, before awaiting network requests.
  const printTab=purpose==='print'?window.open('','_blank'):null;
  if(purpose==='print'&&!printTab){setError('Allow pop-ups to open the protected print-ready PDF.');return;}
  setPrinting(true);setError('');
  try {
   const path=`/v1/documents/${documentId}/export?${new URLSearchParams({versionId,purpose})}`;
   const blob=await authorizedPdfRequest(path);
   const url=URL.createObjectURL(blob);
   if(purpose==='download'){
    const link=document.createElement('a');link.href=url;link.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}-watermarked.pdf`;
    document.body.append(link);link.click();link.remove();
   }else if(printTab){
    // The browser's built-in PDF viewer prints the actual stamped PDF bytes.
    // No browser-only CSS watermark or raster print overlay is trusted.
    printTab.location.href=url;
   }
   // Keep URL alive while the browser consumes the file or print viewer.
   window.setTimeout(()=>URL.revokeObjectURL(url),purpose==='download'?120_000:600_000);
  }catch(cause){if(printTab)printTab.close();mutationError(cause)}finally{setPrinting(false)}
 };
 return <div className="document-preview-overlay" role="presentation"><section className="document-preview-dialog study-dialog" role="dialog" aria-modal="true" aria-label={`Study ${title}`}>
  <header className="document-preview-topbar study-topbar"><button className="document-preview-control" onClick={()=>setShowRail(v=>!v)} aria-label={showRail?'Hide page previews':'Show page previews'} aria-expanded={showRail}><Menu size={17}/></button>
   <div className="document-preview-title"><strong title={title}>{title}</strong><small><ShieldCheck size={12}/> Secure student study · {pageCount} pages</small></div>
   <span className="study-progress-header"><BookCheck size={15}/>{readCount}/{pageCount} read</span>

   <button className="document-preview-control" onClick={onClose} aria-label="Close viewer"><X size={20}/></button>
  </header>
  <div className="study-toolbar" role="toolbar" aria-label="Reading and annotation controls">
   <div className="study-tools">
    {([['move',MousePointer2,'Navigate'],['pen',PenLine,'Write'],['highlighter',Highlighter,'Highlight'],['eraser',Eraser,'Eraser']] as const).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>setMode(id)} className={mode===id?'is-selected':''} aria-pressed={mode===id} title={label} disabled={saving}><Icon size={17}/><span>{label}</span></button>)}
    {mode!=='move'&&<div className="study-colors" aria-label="Pen colors">{palette.map(c=><button key={c} type="button" style={{backgroundColor:c}} className={color===c?'is-current':''} onClick={()=>setColor(c)} aria-label={`Select ink color ${c}`} aria-pressed={color===c}/>)}</div>}
    <button type="button" disabled={saving||!pageReady||ink.length===0} onClick={()=>void saveInk(ink.slice(0,-1))} title="Undo last annotation"><RotateCcw size={16}/><span>Undo</span></button>
   </div>
   <div className="study-zoom"><button type="button" onClick={()=>setZoom(z=>clamp(+(z-.15).toFixed(2),MIN_ZOOM,MAX_ZOOM))} aria-label="Zoom out"><Minus size={16}/></button><span aria-live="polite">{Math.round(zoom*100)}%</span><button type="button" onClick={()=>setZoom(z=>clamp(+(z+.15).toFixed(2),MIN_ZOOM,MAX_ZOOM))} aria-label="Zoom in"><ZoomIn size={16}/></button><select value={fit} onChange={e=>{setFit(e.target.value as Fit);setZoom(1)}} aria-label="Fit PDF to device"><option value="page">Fit page</option><option value="width">Fit width</option><option value="actual">Actual size</option></select></div>
  </div>
  {visibleError&&<div className="document-preview-action-error" role="alert">{visibleError}<button type="button" onClick={()=>onRenew()}>Retry</button></div>}
  <div className="study-content">
   {showRail&&<aside className="study-rail" aria-label="Page previews and read progress"><div className="study-rail-heading"><strong>Pages</strong><span>{percent}% read</span></div><div className="study-progress-bar"><span style={{width:`${percent}%`}}/></div><div className="study-thumb-scroll"><div className="study-thumb-range" aria-live="polite">Pages {thumbStart}–{thumbEnd} of {safePageCount}. Jump to any page below.</div>{Array.from({length:thumbEnd-thumbStart+1},(_,i)=>thumbStart+i).map(n=><ReaderThumbnail key={`${versionId}:${n}`} id={documentId} versionId={versionId} page={n} selected={n===page} read={summary[n]?.isRead??false} hasInk={summary[n]?.hasInk??false} disabled={saving} email={email} loadPage={loadPage} watermark={watermark} onSelect={()=>{if(!busyRef.current)setPage(n)}} onRead={()=>void markRead(n)}/>)}</div></aside>}
   <div className="study-page-column"><div ref={viewportRef} className={`study-viewport mode-${mode}`} onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
    {pageLoading?<div className="document-preview-message" role="status"><RefreshCw size={22}/>Loading protected page…</div>:
     pageUrl&&watermarkReady?<div className="study-paper" style={{width:paperWidth,height:paperHeight}} onDoubleClick={()=>{if(mode==='move')setZoom(z=>z>1?1:1.8)}} onContextMenu={e=>e.preventDefault()}>
      <img src={pageUrl} draggable={false} alt={`Page ${page} of ${title}`} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth&&img.naturalHeight)setNatural({width:img.naturalWidth,height:img.naturalHeight})}}/>
      <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none" className={`study-ink-layer mode-${mode}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} aria-label="Handwritten annotations" role="img">
       {[...ink,...(draft?[draft]:[])].map(stroke=><polyline key={stroke.id} points={stroke.points.map(p=>p.join(',')).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} opacity={stroke.kind==='highlighter'?.42:1} strokeLinecap="round" strokeLinejoin="round"/>) }
      </svg>

     </div>:<div className="document-preview-message">{!watermarkReady?'Verifying student identity for the personalized watermark…':'Protected page image is unavailable. Try reopening this material.'}</div>}
   </div>
   <button type="button" className="study-edge-nav study-edge-nav-prev" onClick={()=>go(-1)} disabled={page===1||saving} aria-label={`Previous page, ${Math.max(1,page-1)} of ${pageCount}`} title="Previous page"><ChevronLeft size={23}/></button>
   <button type="button" className="study-edge-nav study-edge-nav-next" onClick={()=>go(1)} disabled={page===safePageCount||saving} aria-label={`Next page, ${Math.min(pageCount,page+1)} of ${pageCount}`} title="Next page"><ChevronRight size={23}/></button>
   <footer className="study-bottom-controls"><div className="study-page-actions"><button type="button" onClick={()=>void markRead(page)} disabled={saving||!pageReady} className={summary[page]?.isRead?'is-read':''} aria-pressed={summary[page]?.isRead??false}><CheckCircle2 size={16}/>{summary[page]?.isRead?'Read':'Mark page read'}</button><span role="status">{saving?'Saving…':pageReady?'Notes saved securely':'Loading study notes…'}</span></div><div className="study-centered-nav"><span className="study-jump">Page <input type="number" min={1} max={safePageCount} step={1} value={jumpText} onChange={e=>setJumpText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();jumpToPage();}}} onBlur={jumpToPage} style={{width:'72px',textAlign:'center'}} aria-label="Jump to PDF page"/> / {pageCount}</span></div><div className="study-extra-actions">{allowDownload&&<button type="button" disabled={printing||!watermarkReady} onClick={()=>void personalizedPdf('download')}><Download size={15}/>{printing?'Preparing…':'Download'}</button>}{allowPrint&&<button type="button" disabled={printing||!watermarkReady} onClick={()=>void personalizedPdf('print')}><Printer size={15}/> Print</button>}<span className="study-share-disabled"><ShieldCheck size={14}/> Private</span></div></footer>
  </div>
  </div>
 </section></div>;
}
