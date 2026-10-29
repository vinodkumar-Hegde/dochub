import {useMemo,useState} from 'react';
import {Bell,BookOpenCheck,FolderOpen,CalendarDays,UsersRound,ChartNoAxesCombined,ShieldCheck,GraduationCap,Search,Pin,Clock3,ChevronRight,Command,Grid2X2,ArrowUpRight} from 'lucide-react';
import './start.css';
import {TilePictogram, type TileSymbol} from './TilePictogram';

export type AdminView = 'Analytics' | 'Academic Mapping' | 'Uploads' | 'Sessions' | 'Subscribers' | 'Employees' | 'Notifications' | 'Watermark';
type AppKey = AdminView | 'Student Preview';
type StartProps = {
  onOpen:(view:AdminView)=>void;
  onStudent:()=>void;
  allowStudentSwitch?:boolean;
  counts:Partial<Record<AdminView,string>>;
  recent:AdminView[];
  allowedViews?:AdminView[];
  search:string;
  onSearch:(value:string)=>void;
};

const apps = [
  {key:'Academic Mapping',symbol:'mapping',title:'Academic mapping',description:'Courses · Plans · Programmes',icon:BookOpenCheck,theme:'blue',size:'wide',hint:'Organise learning'},
  {key:'Uploads',symbol:'uploads',title:'Uploads',description:'Documents and folders',icon:FolderOpen,theme:'coral',size:'regular',hint:'Manage materials'},
  {key:'Sessions',symbol:'sessions',title:'Live sessions',description:'Schedules and attendance',icon:CalendarDays,theme:'mint',size:'regular',hint:'Plan sessions'},
  {key:'Subscribers',symbol:'subscribers',title:'Subscribers',description:'People and subscriptions',icon:UsersRound,theme:'purple',size:'wide',hint:'Access and plans'},
  {key:'Analytics',symbol:'analytics',title:'Analytics',description:'Operational insights',icon:ChartNoAxesCombined,theme:'amber',size:'wide',hint:'Explore the numbers'},
  {key:'Notifications',symbol:'notices',title:'Notification center',description:'Messages, updates and viewers',icon:Bell,theme:'purple',size:'wide',hint:'Keep students informed'},
  {key:'Watermark',symbol:'employees',title:'Watermark settings',description:'Position, colour and opacity',icon:ShieldCheck,theme:'teal',size:'wide',hint:'Protect your PDFs'},
  {key:'Employees',symbol:'employees',title:'Employee access',description:'Profiles and permissions',icon:ShieldCheck,theme:'teal',size:'wide',hint:'Manage your team'},
  {key:'Student Preview',symbol:'student',title:'Student preview',description:'See the student experience',icon:GraduationCap,theme:'navy',size:'wide',hint:'Switch experience'},
] as const;

function usePinned(){
  const [pinned,setPinned]=useState<string[]>(()=>{
    try {const raw=localStorage.getItem('dochub-admin-pinned-v18'); const value=raw?JSON.parse(raw):null;return Array.isArray(value)?value:['Academic Mapping','Uploads','Sessions','Subscribers'];}
    catch{return ['Academic Mapping','Uploads','Sessions','Subscribers']}
  });
  const toggle=(key:string)=>setPinned(prev=>{const next=prev.includes(key)?prev.filter(x=>x!==key):[...prev,key];try{localStorage.setItem('dochub-admin-pinned-v18',JSON.stringify(next))}catch{}return next});
  return {pinned,toggle};
}

export function StartLauncher({onOpen,onStudent,allowStudentSwitch=false,counts,recent,search,onSearch,allowedViews}:StartProps){
  const {pinned,toggle}=usePinned();
  const filtered=useMemo(()=>apps.filter(app=>(!allowedViews||app.key==='Student Preview'||allowedViews.includes(app.key))&&(allowStudentSwitch || app.key!=='Student Preview') && [app.title,app.description,app.hint,app.key].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[search,allowStudentSwitch]);
  const ordered=useMemo(()=>[...filtered].sort((a,b)=>Number(pinned.includes(b.key))-Number(pinned.includes(a.key))),[filtered,pinned]);
  const open=(key:AppKey)=>key==='Student Preview'?onStudent():onOpen(key);
  return <section className="start-home" aria-label="Admin application launcher">
    <div className="start-section-title"><div><Pin size={16}/><strong>Applications</strong><span>Pinned first</span></div><small>One-click navigation</small></div>
    <div className="start-tile-grid">
      {ordered.map(app=>{const Icon=app.icon;return <div key={app.key} className={`start-tile ${app.size} ${app.theme}`}>
        <button className="start-tile-main" onClick={()=>open(app.key)} title={`Open ${app.title}`}>
          <span className="start-tile-icon"><TilePictogram symbol={app.symbol as TileSymbol} size={59}/></span>
          <span className="start-tile-copy"><strong>{app.title}</strong><small>{app.description}</small></span>
          {app.key!=='Student Preview'&&<span className="start-count">{counts[app.key as AdminView]??''}</span>}
          <ChevronRight size={18} className="start-arrow" aria-hidden="true"/>
        </button>
        <button className={'start-pin '+(pinned.includes(app.key)?'is-pinned':'')} aria-label={(pinned.includes(app.key)?'Unpin ':'Pin ')+app.title} title={(pinned.includes(app.key)?'Unpin':'Pin')+' shortcut'} onClick={()=>toggle(app.key)}><Pin size={14} fill={pinned.includes(app.key)?'currentColor':'none'}/></button>
      </div>})}
    </div>
    {!ordered.length&&<div className="start-no-results">No apps found. Try “sessions”, “subscriber”, or “mapping”.</div>}
    {recent.length>0&&<div className="start-footer"><div className="start-section-title"><div><Clock3 size={16}/><strong>Recently opened</strong></div></div><div className="start-recent">{recent.length?recent.map(k=>{const a=apps.find(x=>x.key===k);if(!a)return null;const Icon=a.icon;return <button key={k} onClick={()=>onOpen(k)}><Icon size={16}/>{a.title}<ArrowUpRight size={14}/></button>}):<span>Open a tile to see your recent apps here.</span>}</div></div>}
  </section>;
}
