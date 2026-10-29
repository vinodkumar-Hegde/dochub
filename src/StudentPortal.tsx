import {useState,type ReactNode} from 'react';
import {Bell,ChevronDown,ChevronRight,Grid2X2,Home,ShieldCheck} from 'lucide-react';
import {TilePictogram, type TileSymbol} from './TilePictogram';
import type {StudentModule} from './StudentLauncher';
import './student-tiles.css';
const options:{key:StudentModule;symbol:TileSymbol}[]=[{key:'Learning',symbol:'learning'},{key:'Sessions',symbol:'sessions'},{key:'Notifications',symbol:'notices'},{key:'Pinned PDFs',symbol:'pinned'}];
type Props={view:'Home'|StudentModule;onView:(v:'Home'|StudentModule)=>void;onAdmin?:()=>void;studentName:string;unread:number;children:ReactNode};
export default function StudentPortal({view,onView,onAdmin,studentName,unread,children}:Props){
 const [appsOpen,setAppsOpen]=useState(false);
 const select=(v:'Home'|StudentModule)=>{onView(v);setAppsOpen(false)};
 return <div className="st-shell"><header className="st-top">
    <div className="st-top-left"><button className="st-brand" onClick={()=>select('Home')} title="Learning home"><img src="/doctutorials-mark.png" alt="DocTutorials"/><span><strong>DocHub</strong><small>by DocTutorials</small></span></button><i className="st-brand-divider"/><span className="st-top-location">Student workspace <ChevronRight size={12} style={{verticalAlign:'middle'}}/> <strong>{view==='Home'?'Home':view==='Learning'?'My learning':view}</strong></span></div>
    <div className="st-top-right"><button title="Go to home" className="st-home-button" onClick={()=>select('Home')} aria-label="Home"><Home size={18}/></button><button onClick={()=>setAppsOpen(v=>!v)} aria-label="Open student apps" aria-expanded={appsOpen}><Grid2X2 size={17}/><span>Apps</span><ChevronDown size={14}/></button><button title="Notifications" aria-label="Notifications" onClick={()=>select('Notifications')}><Bell size={18}/>{unread>0&&<span>{unread}</span>}</button>{onAdmin&&<button onClick={onAdmin} title="Switch to authorized administration workspace"><ShieldCheck size={16}/><span>Admin workspace</span></button>}<div className="st-account" title={studentName}>{studentName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div></div>
    {appsOpen&&<><div className="st-app-shade" onClick={()=>setAppsOpen(false)}/><div className="st-open-nav"><button onClick={()=>select('Home')}><Home size={22}/>Student home</button>{options.map(o=><button key={o.key} onClick={()=>select(o.key)}><TilePictogram symbol={o.symbol} size={35}/>{o.key==='Learning'?'My learning':o.key}</button>)}</div></>}
 </header><main className="st-main">{children}</main></div>
}
