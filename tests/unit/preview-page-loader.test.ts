import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewPageLoader} from '../../src/preview-page-loader.ts';
import type {DocumentReadResult,PreviewDelivery} from '../../src/uploads-client.ts';
const version='12345678-1234-4234-8234-123456789abc';
const grant=(expiresAt=120000):PreviewDelivery=>({baseUrl:`https://cdn.example.com/private/previews/${version}/`,query:'?Policy=policy&Signature=signature&Key-Pair-Id=key',expiresAt});
const reader=(delivery?:PreviewDelivery):DocumentReadResult=>({mode:'pages',versionId:version,pageCount:25,allowDownload:false,allowPrint:false,delivery});
const jpeg=()=>new Response(new Uint8Array([255,216,255]),{headers:{'content-type':'image/jpeg'}});
test('CDN requests exclude API credentials and request only the selected page',async()=>{
 let requested='';let options:RequestInit|undefined;
 const load=createPreviewPageLoader('document',version,grant(),{now:()=>1000,read:async()=>reader(),fallback:async()=>{throw new Error('unexpected fallback')},fetch:async(url,init)=>{requested=String(url);options=init;return jpeg()}});
 await load(25);assert.ok(requested.includes(`/${version}/page-000025.jpg?Policy=`));
 assert.equal(options?.credentials,'omit');assert.equal(options?.headers,undefined);assert.equal(options?.referrerPolicy,'no-referrer');
});
test('concurrent thumbnail/page loads renew an expired grant once',async()=>{
 let renewals=0;
 const load=createPreviewPageLoader('document',version,grant(0),{now:()=>1000,read:async()=>{renewals++;await Promise.resolve();return reader(grant())},fallback:async()=>{throw new Error('unexpected fallback')},fetch:async()=>jpeg()});
 await Promise.all([load(1),load(2),load(3)]);assert.equal(renewals,1);
});
test('revoked authorization and changed published versions stop delivery',async()=>{
 for(const read of [async()=>{throw new Error('Access denied')},async()=>({...reader(grant()),versionId:'replacement'})]){
  let requests=0;const load=createPreviewPageLoader('document',version,grant(0),{now:()=>1000,read,fallback:async()=>new Blob(),fetch:async()=>{requests++;return jpeg()}});
  await assert.rejects(()=>load(1));assert.equal(requests,0);
 }
});
test('an expired CDN response reauthorizes once; unavailable CDN never silently bypasses security',async()=>{
 let renewals=0,requests=0;
 const load=createPreviewPageLoader('document',version,grant(),{now:()=>1000,read:async()=>{renewals++;return reader(grant())},fallback:async()=>{throw new Error('unexpected fallback')},fetch:async()=>{requests++;return new Response('',{status:403})}});
 await assert.rejects(()=>load(1),/delivery is unavailable/);assert.equal(renewals,1);assert.equal(requests,2);
});
test('disabled CDN uses the existing authorized page endpoint',async()=>{
 let path='';const load=createPreviewPageLoader('document',version,undefined,{read:async()=>reader(),fallback:async value=>{path=value;return new Blob()}});
 await load(2);assert.equal(path,`/v1/documents/document/preview/pages/2?versionId=${version}`);
 await assert.rejects(()=>load(0),/Invalid page/);
});
