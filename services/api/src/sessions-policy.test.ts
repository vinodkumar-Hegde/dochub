import test from 'node:test';import assert from 'node:assert/strict';
import {youtubeLinkValid,validSessionMapping,canStudentSeeSession,sessionDateFilter} from './sessions-policy.js';
const mapping={id:'p',courseId:'c',locked:true,plans:[{planId:'a'},{planId:'b'}],subjects:[{subjectId:'s'}]};
test('session publication targets locked mapped programme, subjects and plans',()=>{assert.equal(validSessionMapping(mapping,{courseId:'c',programmeId:'p',subjectId:'s',planIds:['a','b']}),true);assert.equal(validSessionMapping({...mapping,locked:false},{courseId:'c',programmeId:'p',subjectId:'s',planIds:['a']}),false);assert.equal(validSessionMapping(mapping,{courseId:'c',programmeId:'p',subjectId:'s',planIds:['x']}),false);});
test('YouTube sessions require a valid HTTPS YouTube URL',()=>{assert.equal(youtubeLinkValid('YOUTUBE','https://youtu.be/abcdefgh'),true);assert.equal(youtubeLinkValid('YOUTUBE','https://youtube.com.evil.test/watch?v=1'),false);assert.equal(youtubeLinkValid('YOUTUBE','http://youtube.com/watch?v=1'),false);assert.equal(youtubeLinkValid('ZOOM',null),true);});
test('student session visibility checks exact active enrollment and publication',()=>{const now=new Date('2026-10-29T10:00:00Z'),session={courseId:'c',programmeId:'p',subjectId:'s',planIds:['a'],publishedAt:now,status:'SCHEDULED' as const},grant={courseId:'c',programmeId:'p',subjectId:'s',planId:'a',validUntil:null};assert.equal(canStudentSeeSession(session,[grant],now),true);assert.equal(canStudentSeeSession(session,[{...grant,planId:'b'}],now),false);assert.equal(canStudentSeeSession({...session,publishedAt:null},[grant],now),false);assert.equal(canStudentSeeSession(session,[{...grant,validUntil:new Date('2026-10-28')}],now),false);});
test('today uses Indian standard time boundaries',()=>{const where=sessionDateFilter('Today',new Date('2026-10-28T21:00:00Z'));assert.equal(where.startAt?.gte?.toISOString(),'2026-10-28T18:30:00.000Z');});

test('scheduled tab contains scheduled sessions without changing admin upcoming semantics',()=>{assert.deepEqual(sessionDateFilter('Scheduled'),{status:'SCHEDULED'});assert.ok(sessionDateFilter('Upcoming').startAt?.gte);});

import {pastSessionIsReadOnly} from './sessions-policy.js';
test('only super admins may change sessions after their end or when completed',()=>{
 const now=new Date('2026-10-30T10:00:00Z');
 assert.equal(pastSessionIsReadOnly(['CONTENT_MANAGER'],now,'SCHEDULED',now),true);
 assert.equal(pastSessionIsReadOnly(['SUPER_ADMIN'],new Date('2026-10-29'),'COMPLETED',now),false);
 assert.equal(pastSessionIsReadOnly(['CONTENT_MANAGER'],new Date('2026-10-31'),'SCHEDULED',now),false);
 assert.equal(pastSessionIsReadOnly(['CONTENT_MANAGER'],new Date('2026-10-31'),'COMPLETED',now),true);
});
