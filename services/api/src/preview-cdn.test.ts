import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {signPreviewDelivery} from './preview-cdn.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key=privateKey.export({type:'pkcs8',format:'pem'}).toString();
const version='12345678-1234-4234-8234-123456789abc';
const decode=(text:string)=>Buffer.from(text.replace(/-/g,'+').replace(/_/g,'=').replace(/~/g,'/'),'base64');
test('CDN grant is signed, expires quickly and covers only one rendered version',()=>{
 const now=1700000000000,grant=signPreviewDelivery('https://cdn.example.com','key1',key,version,60,now);
 const params=new URLSearchParams(grant.query),policy=decode(params.get('Policy')!).toString();
 const value=JSON.parse(policy);
 assert.equal(value.Statement[0].Resource,`https://cdn.example.com/private/previews/${version}/*`);
 assert.equal(value.Statement[0].Condition.DateLessThan['AWS:EpochTime'],now/1000+60);
 assert.equal(params.get('Key-Pair-Id'),'key1');
 assert.equal(verify('RSA-SHA1',Buffer.from(policy),publicKey,decode(params.get('Signature')!)),true);
 assert.equal(grant.expiresAt,now+60000);assert.ok(!grant.query.includes('PRIVATE'));
});
test('invalid scope and oversized lifetimes cannot be signed',()=>{
 assert.throws(()=>signPreviewDelivery('https://cdn.example.com','key1',key,'../../documents',60));
 assert.throws(()=>signPreviewDelivery('https://cdn.example.com','key1',key,version,3600));
});
