import type {ReactNode} from 'react';
import {WorkspaceHeader} from './WorkspaceHeader';
import type {StudentModule} from './StudentLauncher';
import './student-tiles.css';
type Props={view:'Home'|StudentModule;onView:(view:'Home'|StudentModule)=>void;onAdmin?:()=>void;studentName:string;unread:number;children:ReactNode;onResult?:(module:string,id?:string)=>void};
export default function StudentPortal({view,onView,unread,children,onResult}:Props){
 return <div className="st-shell"><WorkspaceHeader title={view} onHome={()=>onView('Home')} onNavigate={(module,id)=>onResult?onResult(module,id):onView(module==='Uploads'?'Learning':module as StudentModule)} modules={['Learning','Sessions','Notifications','Pinned PDFs']} unread={unread} onNotifications={()=>onView('Notifications')}/><main className="st-main">{children}</main></div>;
}
