export type SessionStatus='DRAFT'|'SCHEDULED'|'POSTPONED'|'CANCELLED'|'COMPLETED';
export type SessionPlatform='DOCTUTORIALS_APP'|'YOUTUBE'|'ZOOM'|'DTLC';
export function youtubeLinkValid(platform:SessionPlatform,url:string|null|undefined):boolean{
  if(platform!=='YOUTUBE')return !url;
  if(!url)return false;
  try{const parsed=new URL(url);return parsed.protocol==='https:'&&['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(parsed.hostname) && parsed.pathname.length>1;}
  catch{return false;}
}
export function validSessionMapping(p:{id:string;courseId:string;locked:boolean;plans:{planId:string}[];subjects:{subjectId:string}[]}|null,input:{courseId:string;programmeId:string;subjectId:string;planIds:string[]}):boolean{
  return !!p&&p.locked&&p.id===input.programmeId&&p.courseId===input.courseId&&input.planIds.length>0&&new Set(input.planIds).size===input.planIds.length&&p.subjects.some(s=>s.subjectId===input.subjectId)&&input.planIds.every(id=>p.plans.some(x=>x.planId===id));
}
export function canStudentSeeSession(session:{courseId:string;programmeId:string;subjectId:string;planIds:readonly string[];publishedAt:Date|null;status:SessionStatus},grants:readonly {courseId:string;programmeId:string;subjectId:string;planId:string;validUntil:Date|null;activeFrom?:Date}[],now=new Date()):boolean{
  return !!session.publishedAt&&session.status!=='DRAFT'&&grants.some(g=>g.courseId===session.courseId&&g.programmeId===session.programmeId&&g.subjectId===session.subjectId&&session.planIds.includes(g.planId)&&(!g.activeFrom||g.activeFrom<=now)&&(!g.validUntil||g.validUntil>now));
}
export function sessionDateFilter(tab:'Today'|'Upcoming'|'Completed'|'Scheduled'|'All',now=new Date()):{status?:SessionStatus;startAt?:{gte?:Date;lt?:Date}}{
  const inIndia=new Date(now.getTime()+330*60_000);
  const start=new Date(Date.UTC(inIndia.getUTCFullYear(),inIndia.getUTCMonth(),inIndia.getUTCDate())-330*60_000);
  const end=new Date(start.getTime()+86400_000);
  if(tab==='Today')return {startAt:{gte:start,lt:end}};
  if(tab==='Upcoming')return {startAt:{gte:end}};
  if(tab==='Completed')return {status:'COMPLETED'};
  if(tab==='Scheduled')return {status:'SCHEDULED'};
  return {};
}

export function pastSessionIsReadOnly(roles:readonly string[],endAt:Date,status:string,now=new Date()):boolean{return !roles.includes('SUPER_ADMIN')&&(endAt<=now||status==='COMPLETED')}
