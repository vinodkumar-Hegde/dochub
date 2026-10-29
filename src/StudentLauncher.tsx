import {ArrowRight,BookOpen,CalendarDays,ChevronRight,FileText,GraduationCap,Pin} from 'lucide-react';
import {TilePictogram,type TileSymbol} from './TilePictogram';
import './student-tiles.css';
export type StudentModule='Learning'|'Sessions'|'Notifications'|'Pinned PDFs';
export type ProgrammeEntry={id:string;name:string;subjectCount:number;materialCount:number};
export type PinnedEntry={id:string;name:string;pages:number};
type Props={courseName:string;programmes:ProgrammeEntry[];pinned:PinnedEntry[];sessionsCount:number;unreadCount:number;onModule:(s:StudentModule)=>void;onProgramme:(programmeId:string)=>void;onPdf:(id:string)=>void};
const navigation:{key:StudentModule;title:string;detail:string;symbol:TileSymbol}[]=[
 {key:'Learning',title:'My learning',detail:'Programmes and materials',symbol:'learning'},
 {key:'Sessions',title:'Live sessions',detail:'Today and upcoming',symbol:'sessions'},
 {key:'Notifications',title:'Notifications',detail:'Updates and reminders',symbol:'notices'},
 {key:'Pinned PDFs',title:'Pinned PDFs',detail:'Your saved shortcuts',symbol:'pinned'}
];
const programmeSymbols:TileSymbol[]=['mapping','learning','anatomy','physiology'];
export default function StudentLauncher({courseName,programmes,pinned,sessionsCount,unreadCount,onModule,onProgramme,onPdf}:Props){
 const matching=programmes;
 return <section className="st-home" aria-label="Student workspace">
   <div className="st-heading"><div className="st-overline"><GraduationCap size={15}/> {courseName.toUpperCase()} · LEARNING SPACE</div><h1>Your modules</h1><p>Choose a module to get started, or browse your subscribed programmes.</p></div>
   <div className="st-actions" aria-label="Student navigation">
     {navigation.map(a=><button key={a.key} className={`st-action st-${a.symbol} ${a.key==='Notifications'&&unreadCount>0?'has-unread':''}`} onClick={()=>onModule(a.key)}>
       <TilePictogram symbol={a.symbol} size={55}/><span className="st-action-text"><strong>{a.title}</strong><small>{a.detail}</small></span>
       {a.key==='Sessions'&&sessionsCount>0&&<span className="st-count">{sessionsCount}</span>}
       {a.key==='Notifications'&&unreadCount>0&&<span className="st-count">{unreadCount}</span>}
       {a.key==='Pinned PDFs'&&pinned.length>0&&<span className="st-count">{pinned.length}</span>}
       <ArrowRight className="st-action-arrow" size={18}/>
     </button>)}
   </div>
   <div className="st-section-head"><div><span className="st-overline"><BookOpen size={15}/> YOUR COURSE CATALOGUE</span><h2>Browse by programme</h2><p>Choose a programme first. Only its mapped subjects will appear next.</p></div></div>
   <div className="st-programme-grid">
      {matching.map((p,index)=><button key={p.id} className={`st-programme-card st-programme-tone-${index%4}`} onClick={()=>onProgramme(p.id)}>
        <span className="st-programme-card-top"><TilePictogram symbol={programmeSymbols[index%programmeSymbols.length]} size={58}/><span className="st-programme-open"><ArrowRight size={18}/></span></span>
        <span className="st-programme-card-info"><strong>{p.name}</strong><small>{p.subjectCount} {p.subjectCount===1?'subject':'subjects'} · {p.materialCount} {p.materialCount===1?'material':'materials'}</small><em>Open programme <ChevronRight size={14}/></em></span>
      </button>)}
   </div>
   {!matching.length&&<div className="st-empty">No programmes are available yet.</div>}
   {programmes.length===0&&<div className="st-empty"><BookOpen size={22}/> No programmes are available for this subscription.</div>}
   {pinned.length>0&&<div className="st-pin-section"><h2><Pin size={18}/> Pinned PDFs</h2><div className="st-pin-grid">{pinned.slice(0,4).map(p=><button key={p.id} onClick={()=>onPdf(p.id)}><FileText size={18}/><span>{p.name}<small>{p.pages} pages</small></span><ChevronRight size={16}/></button>)}</div></div>}
 </section>
}
