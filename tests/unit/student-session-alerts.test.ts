import test from 'node:test';
import assert from 'node:assert/strict';
import {todaySessionAlerts} from '../../src/student-session-alerts.ts';
import type {StudentLiveSession} from '../../src/sessions-client.ts';
const session=(changes:Partial<StudentLiveSession>={})=>({id:'one',publishedAt:'2026-10-29T12:00:00Z',status:'SCHEDULED',startAt:'2026-10-29T19:00:00Z',endAt:'2026-10-29T20:00:00Z',...changes}) as StudentLiveSession;
test('same-day alerts follow India midnight rather than UTC midnight',()=>{
 const now=Date.parse('2026-10-29T18:45:00Z'); // 00:15 on 30 October IST
 assert.equal(todaySessionAlerts([session()],now).length,1);
 assert.equal(todaySessionAlerts([session({startAt:'2026-10-29T18:00:00Z'})],now).length,0);
 assert.equal(todaySessionAlerts([session({startAt:'2026-10-30T19:00:00Z',endAt:'2026-10-30T20:00:00Z'})],now).length,0);
});
test('only published scheduled sessions that have not ended generate alerts',()=>{
 const now=Date.parse('2026-10-29T19:30:00Z');
 for(const item of [session({status:'CANCELLED'}),session({status:'POSTPONED'}),session({status:'COMPLETED'}),session({publishedAt:null}),session({endAt:new Date(now).toISOString()})])assert.deepEqual(todaySessionAlerts([item],now),[]);
 assert.equal(todaySessionAlerts([session()],now).length,1,'a currently live session remains visible');
});
test('today alerts sort by start time and reject malformed dates',()=>{
 const now=Date.parse('2026-10-29T18:45:00Z');
 const result=todaySessionAlerts([session({id:'later',startAt:'2026-10-29T19:30:00Z'}),session({id:'earlier'}),session({startAt:'bad'})],now);
 assert.deepEqual(result.map(s=>s.id),['earlier','later']);
});
