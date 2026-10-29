import {authorizedRequest,authorizedFileRequest} from './auth-client';
export type NotificationFile={id:string;name:string;mimeType:string;size:number};
export type NotificationMessage={id:string;kind:'CUSTOM'|'MATERIAL'|'SESSION';title:string;body:string;createdAt:string;courseIds:string[];programmeIds:string[];planIds:string[];sourceId:string|null;attachments:NotificationFile[];recipients?:number;viewers?:number;readAt?:string|null};
export type NotificationDetail=NotificationMessage & {people?:Array<{readAt:string;user:{id:string;displayName:string|null;email:string|null}}>};
export type NotificationPage={items:NotificationMessage[];total:number;nextPage:number|null};
export type NotificationTarget={courseIds:string[];programmeIds:string[];planIds:string[]};
export type NotificationDraft={title:string;body:string;target:NotificationTarget;attachments:Array<{name:string;mimeType:string;base64:string}>;requestId:string};
export const notificationsClient={
 list:(admin:boolean,args:{kind:string;q:string;page:number;unread?:boolean})=>authorizedRequest<NotificationPage>(`/v1/${admin?'admin':'student'}/notifications?${new URLSearchParams({kind:args.kind,q:args.q,page:String(args.page),...(args.unread?{unread:'true'}:{})})}`),
 detail:(id:string,page=1)=>authorizedRequest<NotificationDetail & {nextPage:number|null}>(`/v1/admin/notifications/${id}?page=${page}`),
 read:(id:string)=>authorizedRequest<NotificationDetail>(`/v1/student/notifications/${id}/read`,{method:'POST',body:'{}'}),
 syncPublications:()=>authorizedRequest<{created:number;hasMore:boolean}>('/v1/admin/notifications/sync-publications',{method:'POST',body:'{}'}),
 audience:(target:NotificationTarget)=>authorizedRequest<{count:number}>('/v1/admin/notifications/audience',{method:'POST',body:JSON.stringify(target)}),
 send:(draft:NotificationDraft)=>authorizedRequest<{id:string;recipients:number}>('/v1/admin/notifications',{method:'POST',body:JSON.stringify(draft)}),
 unread:()=>authorizedRequest<{count:number}>('/v1/student/notifications/unread'),
 download:async(id:string,file:NotificationFile)=>{
  const blob=await authorizedFileRequest(`/v1/notifications/${id}/attachments/${file.id}`),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 },
};
