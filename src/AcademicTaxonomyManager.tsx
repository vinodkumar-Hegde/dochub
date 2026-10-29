import {useEffect,useMemo,useState} from 'react';
import {Archive,Eye,EyeOff,Lock,Unlock,Pencil,Plus,RotateCcw,ShieldAlert} from 'lucide-react';
import {academicClient,type AcademicCatalog,type AcademicKind,type AcademicManageKind,type AcademicRecordState} from './academic-client';

type Item=AcademicRecordState&{id:string;name:string;courseId?:string};
const categories:Array<[AcademicManageKind,string,AcademicKind]>=[
  ['courses','Courses','Course'],['plans','Plans','Plan'],['programmes','Programmes','Programme'],['subjects','Subjects','Subject'],['faculty','Faculty','Faculty'],
];
export function AcademicTaxonomyManager({catalog,onRefresh,selection,onEditClosed}:{catalog:AcademicCatalog;onRefresh:()=>Promise<void>;selection?:{kind:AcademicManageKind;id:string}|null;onEditClosed?:()=>void}){
  const [kind,setKind]=useState<AcademicManageKind>('programmes');
  const [edit,setEdit]=useState<Item|null>(null);
  const [draftName,setDraftName]=useState('');
  const [hidden,setHidden]=useState(false);
  const [accessLocked,setAccessLocked]=useState(false);
  const [archived,setArchived]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [newFaculty,setNewFaculty]=useState('');
  const rows=useMemo<Item[]>(()=>{
    if(kind==='courses')return catalog.courses;
    if(kind==='plans')return catalog.plans;
    if(kind==='programmes')return catalog.programmes;
    if(kind==='subjects')return catalog.subjects;
    return catalog.faculty??[];
  },[kind,catalog]);
  const open=(item:Item)=>{setEdit(item);setDraftName(item.name);setHidden(item.hidden);setAccessLocked(item.accessLocked);setArchived(Boolean(item.archivedAt));setError('');};
  useEffect(()=>{if(!selection)return;setKind(selection.kind);const items=selection.kind==='courses'?catalog.courses:selection.kind==='plans'?catalog.plans:selection.kind==='programmes'?catalog.programmes:selection.kind==='subjects'?catalog.subjects:catalog.faculty??[];const item=items.find(x=>x.id===selection.id);if(item)open(item);},[selection?.kind,selection?.id]);
  const close=()=>{setEdit(null);onEditClosed?.();};
  const save=async()=>{
    if(!edit)return;
    if(draftName.trim()===edit.name&&hidden===edit.hidden&&accessLocked===edit.accessLocked&&archived===Boolean(edit.archivedAt)){close();return;}
    if(archived&&!edit.archivedAt&&!window.confirm(`Archive ${edit.name}? It will become unavailable to students, uploads and session publication. Existing data will be retained.`))return;
    setBusy(true);setError('');
    try{
      await academicClient.manage(kind,edit.id,edit.revision,{
        ...(draftName.trim()!==edit.name?{name:draftName.trim()}:{}),
        ...(hidden!==edit.hidden?{hidden}:{}),
        ...(accessLocked!==edit.accessLocked?{accessLocked}:{}),
        ...(archived!==Boolean(edit.archivedAt)?{archived}:{}),
      });
      await onRefresh();close();setNotice('Academic record updated and audited');
    }catch(c){setError(c instanceof Error?c.message:'Unable to save academic record');}finally{setBusy(false);}
  };
  const addFaculty=async()=>{
    if(newFaculty.trim().length<2)return setError('Enter a faculty name');
    setBusy(true);setError('');
    try{await academicClient.create('Faculty',newFaculty.trim());setNewFaculty('');await onRefresh();setNotice('Faculty added to scheduling directory');}
    catch(c){setError(c instanceof Error?c.message:'Unable to add faculty');}finally{setBusy(false);}
  };
  return <section className="a-panel academic-manage" aria-label="Academic catalogue controls">
    <div className="a-panel-title"><div><h2>Academic catalogue</h2><p>Update, hide, lock and archive records. Changes affect student visibility immediately.</p></div></div>
    <div className="a-bar"><label>Manage<select value={kind} onChange={e=>{setKind(e.target.value as AcademicManageKind);setNotice('');setError('');}}>{categories.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      {kind==='faculty'&&<div className="academic-faculty-inline"><input aria-label="New faculty name" placeholder="Faculty name" value={newFaculty} onChange={e=>setNewFaculty(e.target.value)} maxLength={120}/><button className="a-btn" onClick={()=>void addFaculty()} disabled={busy}><Plus size={15}/> Add faculty</button></div>}
    </div>
    {notice&&<p className="academic-manage-success" role="status">{notice}</p>}
    {error&&!edit&&<p className="a-mapping-feedback a-mapping-error" role="alert">{error}</p>}
    <div className="academic-manage-list">{rows.map(item=><div key={item.id} className="academic-manage-row">
      <span><strong>{item.name}</strong>{item.courseId&&<small> · {catalog.courses.find(c=>c.id===item.courseId)?.name??'Course'}</small>}</span>
      <span className="academic-manage-states">{item.archivedAt?<small>Archived</small>:item.hidden?<small>Hidden</small>:item.accessLocked?<small>Locked</small>:<small>Visible</small>}</span>
      <button className="a-btn" onClick={()=>open(item)} aria-label={`Edit ${item.name}`}><Pencil size={14}/> Options</button>
    </div>)}{!rows.length&&<p className="subscriber-hint">No {categories.find(k=>k[0]===kind)?.[1].toLowerCase()} yet.</p>}</div>
    {edit&&<div className="a-modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)close()}}><div className="a-modal academic-manage-modal" role="dialog" aria-modal="true" aria-label={`Edit ${edit.name}`}>
      <h2>Manage {edit.name}</h2><p>Only Super Admin can archive and restore an academic record. Archiving never deletes linked PDFs or sessions.</p>
      <label>Name<input value={draftName} maxLength={120} onChange={e=>setDraftName(e.target.value)} /></label>
      <div className="academic-manage-options"><label><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/>{hidden?<EyeOff size={16}/>:<Eye size={16}/>} Hidden from students</label>
        <label><input type="checkbox" checked={accessLocked} onChange={e=>setAccessLocked(e.target.checked)}/>{accessLocked?<Lock size={16}/>:<Unlock size={16}/>} Access locked</label>
        <label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{archived?<RotateCcw size={16}/>:<Archive size={16}/>} {archived?'Archived — restore by unchecking':'Archive record (Super Admin)'}</label></div>
      {(hidden||accessLocked||archived)&&<p className="academic-manage-warning"><ShieldAlert size={16}/> Student access and new publication will be blocked for affected mappings.</p>}
      {error&&<p role="alert" className="a-mapping-feedback a-mapping-error">{error}</p>}
      <div className="a-actions"><button className="a-btn" disabled={busy} onClick={close}>Cancel</button><button className="a-btn primary" disabled={busy||draftName.trim().length<2} onClick={()=>void save()}>{busy?'Saving…':'Save changes'}</button></div>
    </div></div>}
  </section>;
}
