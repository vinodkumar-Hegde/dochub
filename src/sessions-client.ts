import {authorizedRequest} from './auth-client';
export type SessionStatus='DRAFT'|'SCHEDULED'|'POSTPONED'|'CANCELLED'|'COMPLETED';
export type SessionPlatform='DOCTUTORIALS_APP'|'YOUTUBE'|'ZOOM'|'DTLC';
export type LiveSessionInput={courseId:string;programmeId:string;subjectId:string;mappingRevision?:number;topic:string;facultyName:string;facultyId:string|null;startAt:string;endAt:string;platform:SessionPlatform;youtubeUrl:string|null;remarks:string|null;planIds:string[];status:SessionStatus};
export type LiveSession=LiveSessionInput&{id:string;revision:number;publishedAt:string|null;updatedById:string};
export type SessionTab='Today'|'Upcoming'|'Completed'|'Scheduled'|'All';
export type StudentAttendanceIntent='WILL_ATTEND'|'NOT_AVAILABLE'|'WATCH_RECORDING';
export type StudentLiveSession=LiveSession & {programmeName:string;subjectName:string;attendance:{response:StudentAttendanceIntent;markedAt:string}|null};
export type StudentSessionPage={programmes:Array<{id:string;name:string;courseId:string}>;items:StudentLiveSession[];nextPage:number|null};
const api=<T,>(path:string,method='GET',body?:unknown)=>authorizedRequest<T>(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
export const sessionsClient={
  summary:()=>api<{total:number;published:number}>('/v1/admin/sessions/summary'),
  adminList:(args:{courseId?:string;programmeId?:string;tab?:SessionTab;q?:string})=>api<{items:LiveSession[]}>(`/v1/admin/sessions?${new URLSearchParams(Object.entries(args).filter((v):v is [string,string]=>typeof v[1]==='string'&&!!v[1]))}`),
  create:(session:LiveSessionInput)=>api<{id:string}>('/v1/admin/sessions','POST',session),
  update:(session:LiveSessionInput,old:LiveSession)=>api<{status:string}>(`/v1/admin/sessions/${old.id}`,'PUT',{...session,revision:old.revision}),
  publication:(session:LiveSession,publish:boolean)=>api<{status:string}>(`/v1/admin/sessions/${session.id}/publication`,'POST',{revision:session.revision,publish}),
  student:(programmeId?:string,tab:SessionTab='All',page=1)=>api<StudentSessionPage>(`/v1/student/sessions?${new URLSearchParams({...programmeId?{programmeId}:{},tab,page:String(page),limit:'100'})}`),
  submitAttendance:(id:string,response:StudentAttendanceIntent)=>api<{response:StudentAttendanceIntent;markedAt:string;locked:true}>(`/v1/student/sessions/${encodeURIComponent(id)}/attendance`,'POST',{response}),
};
