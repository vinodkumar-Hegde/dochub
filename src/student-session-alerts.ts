import type {StudentLiveSession} from './sessions-client';
const indiaDay=(value:number)=>new Date(value+330*60_000).toISOString().slice(0,10);
/** Alert only for published, scheduled sessions still ahead or in progress today (IST). */
export function todaySessionAlerts(sessions:readonly StudentLiveSession[],now=Date.now()):StudentLiveSession[]{
 const today=indiaDay(now);
 return sessions.filter(s=>s.publishedAt&&s.status==='SCHEDULED'&&Number.isFinite(Date.parse(s.startAt))&&Number.isFinite(Date.parse(s.endAt))&&indiaDay(Date.parse(s.startAt))===today&&Date.parse(s.endAt)>now)
  .sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt));
}
