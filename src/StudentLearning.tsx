import {ArrowLeft,ArrowRight,BookOpen,ChevronRight,FileText,FolderOpen,GraduationCap,Pin} from 'lucide-react';
import {TilePictogram,subjectSymbol} from './TilePictogram';
import type {Material,Programme,Student,Subject} from './data';
import './student-tiles.css';
type Props={
 courseLabel:string;
 studentId:string;
 studentStatus:Student['status'];
 students:Student[];
 programmes:Programme[];
 subjects:Subject[];
 materials:Material[];
 programmeId:string;
 subjectId:string;
 pinnedDocs:string[];
 reading:Record<string,'Read'|'Plan to Read'>;
 onStudentChange:(id:string)=>void;
 onProgramme:(id:string)=>void;
 onSubject:(id:string)=>void;
 onBackToProgrammes:()=>void;
 onBackToSubjects:()=>void;
 onOpenDocument:(id:string)=>void;
 onTogglePin:(id:string)=>void;
};
export default function StudentLearning({courseLabel,studentId,studentStatus,students,programmes,subjects,materials,programmeId,subjectId,pinnedDocs,reading,onStudentChange,onProgramme,onSubject,onBackToProgrammes,onBackToSubjects,onOpenDocument,onTogglePin}:Props){
 const programme=programmes.find(p=>p.id===programmeId);
 const subject=programme?.subjectIds.includes(subjectId)?subjects.find(s=>s.id===subjectId):undefined;
 const programmeMaterials=materials.filter(m=>programme&&m.programmeId===programme.id);
 const subjectTiles=(programme?.subjectIds||[]).map(id=>({subject:subjects.find(s=>s.id===id),count:materials.filter(m=>m.programmeId===programme?.id&&m.subjectId===id).length})).filter(x=>x.subject);
 const documents=materials.filter(m=>programme&&subject&&m.programmeId===programme.id&&m.subjectId===subject.id).sort((a,b)=>Number(pinnedDocs.includes(`${studentId}:${b.id}`))-Number(pinnedDocs.includes(`${studentId}:${a.id}`)));
 const readPages=(doc:Material)=>Array.from({length:doc.pages},(_,index)=>index+1).filter(page=>reading[`${studentId}:${doc.id}:${page}`]==='Read').length;
 const progress=(doc:Material)=>Math.round(readPages(doc)/Math.max(1,doc.pages)*100);
 return <section className="st-learning" aria-label="My learning">
  <div className="st-learning-heading">
   <div><div className="st-overline"><GraduationCap size={15}/> {courseLabel.toUpperCase()} · LEARNING SPACE</div><h1>My learning</h1><p>{!programme?'Choose a programme to see its subjects.':!subject?'Choose a subject within this programme.':'Open a material to continue studying.'}</p></div>
   <label className="st-learner-switch"><span>Preview learner</span><select value={studentId} onChange={e=>onStudentChange(e.target.value)} aria-label="Preview learner">{students.map(s=><option key={s.id} value={s.id}>{s.name}{s.status==='Expired'?' (Expired)':''}</option>)}</select></label>
  </div>
  <div className="st-learning-path" aria-label="Learning navigation">
   <button className={!programme?'is-current':''} onClick={onBackToProgrammes}><BookOpen size={15}/> Programmes</button>
   {programme&&<><ChevronRight size={15} className="st-path-separator"/><button className={!subject?'is-current':''} onClick={onBackToSubjects}>{programme.name}</button></>}
   {subject&&<><ChevronRight size={15} className="st-path-separator"/><span className="is-current st-path-current">{subject.name}</span></>}
   {programme&&<button className="st-path-back" onClick={subject?onBackToSubjects:onBackToProgrammes}><ArrowLeft size={15}/>{subject?'All subjects':'All programmes'}</button>}
  </div>
  {studentStatus==='Expired'?<div className="st-learning-empty"><span className="st-empty-icon"><BookOpen size={25}/></span><strong>Subscription expired</strong><p>Learning materials are unavailable for this subscription. Contact the course administrator for access.</p></div>:!programme?<>
   <div className="st-learning-section-title"><div><span className="st-overline"><FolderOpen size={15}/> YOUR COURSE CATALOGUE</span><h2>Browse by programme</h2></div><span className="st-result-count">{programmes.length} {programmes.length===1?'programme':'programmes'}</span></div>
   <div className="st-learning-tile-grid st-learning-programmes">
    {programmes.map((p,index)=>{const count=materials.filter(m=>m.programmeId===p.id).length;return <button key={p.id} className={`st-learning-tile st-learning-programme st-programme-tone-${index%4}`} onClick={()=>onProgramme(p.id)}>
      <span className="st-learning-tile-top"><TilePictogram symbol={index%3===0?'mapping':index%3===1?'learning':'student'} size={64}/><span className="st-tile-arrow"><ArrowRight size={18}/></span></span>
      <span className="st-learning-tile-copy"><strong>{p.name}</strong><small>{p.subjectIds.length} {p.subjectIds.length===1?'subject':'subjects'}</small><em>{count} {count===1?'material':'materials'} <ChevronRight size={14}/></em></span>
    </button>})}
   </div>
   {programmes.length===0&&<div className="st-learning-empty"><span className="st-empty-icon"><GraduationCap size={25}/></span><strong>No programmes available</strong><p>No programmes are currently mapped to your active subscription.</p></div>}
  </>:!subject?<>
   <div className="st-learning-section-title"><div><span className="st-overline"><BookOpen size={15}/> {programme.name.toUpperCase()}</span><h2>Choose a subject</h2><p>Only subjects mapped to this programme are shown.</p></div><span className="st-result-count">{subjectTiles.length} {subjectTiles.length===1?'subject':'subjects'}</span></div>
   <div className="st-learning-tile-grid st-learning-subjects">
    {subjectTiles.map(({subject:sub,count},index)=>sub&&<button key={sub.id} className={`st-learning-tile st-learning-subject st-${subjectSymbol(sub.name)} st-learning-subject-tone-${index%4}`} onClick={()=>onSubject(sub.id)}>
      <span className="st-learning-tile-top"><TilePictogram symbol={subjectSymbol(sub.name)} size={64}/><span className="st-tile-arrow"><ArrowRight size={18}/></span></span>
      <span className="st-learning-tile-copy"><strong>{sub.name}</strong><small>{count} {count===1?'published material':'published materials'}</small><em>Open subject <ChevronRight size={14}/></em></span>
    </button>)}
   </div>
   {subjectTiles.length===0&&<div className="st-learning-empty"><span className="st-empty-icon"><BookOpen size={25}/></span><strong>No subjects mapped</strong><p>This programme does not currently contain any subjects.</p></div>}
  </>:<>
   <div className="st-learning-section-title"><div><span className="st-overline"><BookOpen size={15}/> {subject.name.toUpperCase()}</span><h2>Study materials</h2><p>Open a document or pin it for quick access.</p></div><span className="st-result-count">{documents.length} {documents.length===1?'material':'materials'}</span></div>
   <div className="st-learning-tile-grid st-learning-documents">
    {documents.map((doc,index)=>{const pct=progress(doc);const isPinned=pinnedDocs.includes(`${studentId}:${doc.id}`);return <article key={doc.id} className={`st-document-tile st-document-tone-${index%4}`}>
      <button className="st-document-open" onClick={()=>onOpenDocument(doc.id)} aria-label={`Open ${doc.title}`}>
       <span className="st-document-icon"><FileText size={27} strokeWidth={1.8}/><small>{doc.kind}</small></span>
       <span className="st-document-copy"><strong title={doc.title}>{doc.title}</strong><small>{doc.folder}</small></span>
       <span className="st-document-meta"><span>{doc.pages} {doc.pages===1?'page':'pages'}</span><span>{pct?`${pct}% read`:'Not started'}</span></span>
       <span className="st-document-progress" aria-label={`${pct}% read`}><i style={{width:`${pct}%`}}/></span>
      </button>
      <button className={`st-document-pin ${isPinned?'is-pinned':''}`} onClick={()=>onTogglePin(doc.id)} aria-label={isPinned?`Unpin ${doc.title}`:`Pin ${doc.title}`} aria-pressed={isPinned}><Pin size={17} fill={isPinned?'currentColor':'none'}/></button>
     </article>})}
   </div>
   {documents.length===0&&<div className="st-learning-empty"><span className="st-empty-icon"><FileText size={25}/></span><strong>No published materials yet</strong><p>Published documents for {subject.name} will appear here when they are available.</p></div>}
   {programmeMaterials.length>0&&<div className="st-learning-footnote">Showing {documents.length} material{documents.length===1?'':'s'} in {subject.name}. Other subjects in {programme.name} are not shown on this screen.</div>}
  </>}
 </section>
}
