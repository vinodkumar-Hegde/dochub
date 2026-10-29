import {Activity, BellRing, BookOpen, BookOpenCheck, CalendarClock, ChartNoAxesCombined, ClipboardList, FileHeart, FileText, FolderOpen, GraduationCap, HeartPulse, Microscope, Pill, Pin, ShieldCheck, Stethoscope, UsersRound, type LucideIcon} from 'lucide-react';
import type {CSSProperties} from 'react';
import './tile-icons.css';

export type TileSymbol='mapping'|'uploads'|'sessions'|'subscribers'|'analytics'|'employees'|'student'|'learning'|'notices'|'pinned'|'anatomy'|'physiology'|'pathology'|'pharmacology'|'microbiology'|'medicine'|'psm'|'default';
const pair:Record<TileSymbol,[LucideIcon,LucideIcon]>={
 mapping:[BookOpenCheck,ClipboardList],uploads:[FolderOpen,FileText],sessions:[CalendarClock,Activity],subscribers:[UsersRound,BookOpen],analytics:[ChartNoAxesCombined,Activity],employees:[ShieldCheck,UsersRound],student:[GraduationCap,BookOpen],learning:[BookOpen,Stethoscope],notices:[BellRing,FileText],pinned:[Pin,FileHeart],anatomy:[Stethoscope,HeartPulse],physiology:[HeartPulse,Activity],pathology:[Microscope,FileText],pharmacology:[Pill,Activity],microbiology:[Microscope,Activity],medicine:[FileHeart,Stethoscope],psm:[ClipboardList,HeartPulse],default:[BookOpen,Activity]
};
const tones:Record<TileSymbol,[string,string,string]>={
 mapping:['#2259b0','#22a5dc','#e8f1ff'],uploads:['#c55d32','#f3a251','#fff0e5'],sessions:['#078371','#27ad94','#def7ed'],subscribers:['#7349ac','#af7ad7','#f2eafd'],analytics:['#3157a3','#65a5e2','#eaf0ff'],employees:['#137a90','#5bc4c0','#e5f7fa'],student:['#5770a1','#8ba6dc','#eef1fa'],learning:['#2863c1','#7bb1e7','#eaf2ff'],notices:['#ad5294','#db91c2','#faeafa'],pinned:['#c47b36','#eab56b','#fff4e3'],anatomy:['#3d6ab7','#e27d78','#edf3ff'],physiology:['#884dba','#c08cde','#f4ebfc'],pathology:['#118b91','#6bc8b9','#e6f8f8'],pharmacology:['#a45a9e','#e0a1cd','#fceefa'],microbiology:['#087c90','#4fc1c4','#e7f8f9'],medicine:['#be5358','#ef9a8b','#fff0ee'],psm:['#507b51','#9acc8b','#eff9ed'],default:['#365d98','#88a4d8','#eaf0fa']
};
export function subjectSymbol(name:string):TileSymbol{const n=name.toLowerCase();if(n.includes('anatom'))return 'anatomy';if(n.includes('physio'))return 'physiology';if(n.includes('patho'))return 'pathology';if(n.includes('pharma'))return 'pharmacology';if(n.includes('micro'))return 'microbiology';if(n.includes('medicine'))return 'medicine';if(n.includes('psm')||n.includes('preventive'))return 'psm';return 'default'}
export function TilePictogram({symbol,size=56}:{symbol:TileSymbol;size?:number}){
 const [Main,Accent]=pair[symbol];const [primary,secondary,background]=tones[symbol];
 return <span aria-hidden="true" className="dt-pictogram" style={{'--dt-icon-primary':primary,'--dt-icon-secondary':secondary,'--dt-icon-bg':background,width:size,height:size} as CSSProperties}>
   <span className="dt-icon-halo"/><Main className="dt-icon-primary" size={Math.round(size*.51)} strokeWidth={1.85}/>
   <span className="dt-icon-accent"><Accent size={Math.round(size*.25)} strokeWidth={2.2}/></span>
 </span>
}
