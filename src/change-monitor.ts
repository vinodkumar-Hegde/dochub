export type WorkspaceChange={contentVersion:string;inboxVersion:string;unreadCount:number};
export type ChangeEvent=WorkspaceChange&{contentChanged:boolean;inboxChanged:boolean};
/** One lightweight request shared by all mounted workspaces, with jitter/backoff. */
export function createChangeMonitor(fetchChanges:(signal:AbortSignal)=>Promise<WorkspaceChange>,visible:()=>boolean,onUnauthorized:()=>void=()=>{}){
 const listeners=new Set<(event:ChangeEvent)=>void>();
 let snapshot:WorkspaceChange|undefined,timer:ReturnType<typeof setTimeout>|undefined,request:AbortController|undefined,failures=0,generation=0;
 const clear=()=>{if(timer!==undefined)clearTimeout(timer);timer=undefined};
 const check=async()=>{
  clear();if(!listeners.size||request||!visible())return;
  const controller=new AbortController(),version=generation;request=controller;
  try{
   const next=await fetchChanges(controller.signal);
   if(version!==generation)return;
   if(typeof next.contentVersion!=='string'||typeof next.inboxVersion!=='string'||!Number.isSafeInteger(next.unreadCount)||next.unreadCount<0)throw new Error('Invalid workspace change response');
   const event={...next,contentChanged:!snapshot||snapshot.contentVersion!==next.contentVersion,inboxChanged:!snapshot||snapshot.inboxVersion!==next.inboxVersion};snapshot=next;failures=0;
   for(const listener of listeners)listener(event);
  }catch(error){if(version===generation){failures++;if(error&&typeof error==='object'&&'status'in error&&[401,403].includes(Number(error.status)))onUnauthorized()}}
  finally{if(request===controller)request=undefined;if(version===generation&&listeners.size&&visible())timer=setTimeout(()=>void check(),Math.min(60000,5000*2**Math.min(failures,4))*(.85+Math.random()*.3))}
 };
 return {
  subscribe(listener:(event:ChangeEvent)=>void){listeners.add(listener);if(listeners.size===1)void check();else if(snapshot)listener({...snapshot,contentChanged:false,inboxChanged:false});return()=>{listeners.delete(listener);if(!listeners.size){generation++;clear();request?.abort();request=undefined;snapshot=undefined;failures=0}}},
  refresh(){if(!visible()){clear();return}if(!request)void check()},
 };
}
