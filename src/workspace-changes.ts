import {useEffect,useRef} from 'react';
import {authorizedRequest} from './auth-client';
import {createChangeMonitor,type WorkspaceChange,type ChangeEvent} from './change-monitor';
const monitor=createChangeMonitor(signal=>authorizedRequest<WorkspaceChange>('/v1/changes',{signal}),()=>document.visibilityState==='visible',()=>window.dispatchEvent(new Event('dochub:account-invalidated')));
export const refreshWorkspaceChanges=()=>monitor.refresh();
export function useWorkspaceChanges(onChange:(event:ChangeEvent)=>void){
 const callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{
  const unsubscribe=monitor.subscribe(event=>callback.current(event)),wake=()=>monitor.refresh();
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
  return()=>{unsubscribe();window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)};
 },[]);
}
