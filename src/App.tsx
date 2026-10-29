import AdminWorkspace from './AdminWorkspace';
import StudentDocumentsWorkspace from './StudentDocumentsWorkspace';
import type {Role} from './data';
export default function App({initialRole,allowedRoles,onLogout}:{initialRole:Role;allowedRoles:Role[];onLogout:()=>void}){
 return initialRole==='Student'?<StudentDocumentsWorkspace initialView="Home"/>:<AdminWorkspace onStudent={()=>{}}/>;
}
