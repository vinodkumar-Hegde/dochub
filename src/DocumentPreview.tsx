import {useEffect,useState} from 'react';
import {AlertCircle,FileText,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {documentApi,type DocumentReadResult} from './uploads-client';
import StudentStudyViewer from './StudentStudyViewer';
import './document-preview.css';

type Props={documentId:string;title:string;onClose:()=>void};
/** Employees retain the existing short-lived authorized PDF preview. Students
 * receive only private, authenticated page JPEGs with separately stored study
 * annotations, never a direct PDF URL in their protected reader. */
export function DocumentPreview({documentId,title,onClose}:Props){
 const [reader,setReader]=useState<DocumentReadResult|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(true);
 const [reload,setReload]=useState(0);
 const [automaticRetries,setAutomaticRetries]=useState(0);
 useEffect(()=>{
  let mounted=true;setBusy(true);setReader(null);setError('');
  void documentApi.read(documentId).then(result=>{if(mounted){setReader(result);setAutomaticRetries(0)}}).catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:'Unable to open protected document')}).finally(()=>{if(mounted)setBusy(false)});
  return()=>{mounted=false};
 },[documentId,reload]);
 // Poll only the lightweight read authorization while processing catches up.
 // Never trigger any PDF scan/render job from the browser.
 useEffect(()=>{
  if(!/secure (pdf |page )?preview/i.test(error)||automaticRetries>=20)return;
  const timer=setTimeout(()=>{setAutomaticRetries(value=>value+1);setReload(value=>value+1)},10_000);
  return()=>clearTimeout(timer);
 },[error,automaticRetries,reload]);
 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&reader?.mode!=='pages')onClose()};
  document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);
 },[reader,onClose]);
 if(reader?.mode==='pages')return <StudentStudyViewer key={`${documentId}:${reader.versionId}`} documentId={documentId} title={title} versionId={reader.versionId} pageCount={reader.pageCount} allowDownload={reader.allowDownload} allowPrint={reader.allowPrint} onClose={onClose} onRenew={()=>setReload(v=>v+1)}/>;
 return <div className="document-preview-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="document-preview-dialog" role="dialog" aria-modal="true" aria-label={`Document preview: ${title}`}>
   <header className="document-preview-topbar"><FileText size={19}/><div className="document-preview-title"><strong title={title}>{title}</strong><small>{reader?.mode==='pdf'?'Authorized administrator PDF preview':'Secure document preview'}</small></div><button type="button" className="document-preview-control" onClick={()=>setReload(v=>v+1)} disabled={busy}><RefreshCw size={17}/> Refresh</button><button className="document-preview-control" type="button" onClick={onClose} aria-label="Close PDF preview"><X size={19}/></button></header>
   <div className="document-preview-body">{busy?<div className="document-preview-message" role="status"><RefreshCw size={22}/> Authorizing PDF preview…</div>:error?<div className="document-preview-message" role="alert"><AlertCircle size={22}/>{error}<button onClick={()=>setReload(v=>v+1)}>Retry</button></div>:reader?.mode==='pdf'?<iframe title={`Administrator PDF preview of ${title}`} src={`${reader.url}#toolbar=0&navpanes=0`} referrerPolicy="no-referrer"/>:<div className="document-preview-message" role="alert">No validated PDF preview is available.</div>}</div>
   <footer className="document-preview-footer"><ShieldCheck size={12}/> Access is verified for each request. Students receive protected page previews, never original-PDF links.</footer>
  </section>
 </div>;
}
