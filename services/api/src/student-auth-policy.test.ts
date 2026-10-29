import test from 'node:test';
import assert from 'node:assert/strict';
import {
  studentPasswordValid,hashStudentPassword,verifyStudentPassword,digestSecret,freshSecret,
  studentSessionCurrent,studentActiveGrant,studentSetCookie,studentCookieName,
  STUDENT_SESSION_MS,STUDENT_IDLE_MS,
} from './student-auth-policy.js';
test('rejects weak/short passwords',()=>{
  assert.equal(studentPasswordValid('short'),false);
  assert.equal(studentPasswordValid('password123456'),false);
  assert.equal(studentPasswordValid('a'.repeat(129)),false);
  assert.equal(studentPasswordValid('A long unique passphrase 2026'),true);
});
test('password hashes are salted and verifiable',async()=>{
  const password='A long unique passphrase 2026';
  const a=await hashStudentPassword(password),b=await hashStudentPassword(password);
  assert.notEqual(a,b);
  assert.equal(await verifyStudentPassword(password,a),true);
  assert.equal(await verifyStudentPassword('Not that password',a),false);
  assert.equal(await verifyStudentPassword(password,'invalid'),false);
});
test('token digest is not the raw token',()=>{
  const secret=freshSecret();
  assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(digestSecret(secret),secret);
  assert.equal(digestSecret(secret),digestSecret(secret));
});
test('session expires at TTL and idle boundary, and revocation wins',()=>{
  const now=new Date('2026-11-01T00:00:00Z');
  const session={expiresAt:new Date(now.getTime()+STUDENT_SESSION_MS),lastSeenAt:now,revokedAt:null};
  assert.equal(studentSessionCurrent(session,now),true);
  assert.equal(studentSessionCurrent(session,new Date(now.getTime()+STUDENT_IDLE_MS)),false);
  assert.equal(studentSessionCurrent({...session,revokedAt:now},now),false);
});
test('student cannot use future or expired grant; valid parallel grant remains',()=>{
  const now=new Date('2026-11-01T00:00:00Z');
  const expired={activeFrom:new Date('2026-01-01'),validUntil:new Date('2026-10-31')};
  const scheduled={activeFrom:new Date('2026-12-01'),validUntil:new Date('2027-12-01')};
  const active={activeFrom:new Date('2026-10-01'),validUntil:null};
  assert.equal(studentActiveGrant([expired,scheduled],now),false);
  assert.equal(studentActiveGrant([expired,scheduled,active],now),true);
});
test('production cookie has Secure HttpOnly SameSite and Host prefix',()=>{
  assert.equal(studentCookieName(true),'__Host-dochub_student');
  assert.match(studentSetCookie('secret',true,3600),/__Host-dochub_student=secret; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure/);
  assert.ok(!studentSetCookie('secret',false,3600).includes('; Secure'));
});
