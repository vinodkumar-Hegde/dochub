import test from 'node:test';import assert from 'node:assert/strict';
import {createPdfPageCache,pdfVisibleRange} from '../../src/pdf-page-cache.ts';
test('deduplicates page requests and evicts least recently used pages within both bounds',async()=>{
 const loads:number[]=[];const cache=createPdfPageCache(async p=>{loads.push(p);return new Blob(['1234567890'])},{maxPages:2,maxBytes:25,concurrency:2});
 await Promise.all([cache.get(1),cache.get(1)]);assert.deepEqual(loads,[1]);await cache.get(2);await cache.get(1);await cache.get(3);assert.equal(cache.stats().pages,2);assert.equal(cache.stats().bytes,20);await cache.get(2);assert.deepEqual(loads,[1,2,3,2]);cache.clear();assert.equal(cache.stats().bytes,0);
});
test('prefetching and foreground requests share a bounded concurrency queue',async()=>{
 let active=0,peak=0;const cache=createPdfPageCache(async p=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return new Blob([String(p)])},{maxPages:4,maxBytes:20,concurrency:2});
 await Promise.all(Array.from({length:30},(_,i)=>cache.get(i+1)));assert.ok(peak<=2);assert.ok(cache.stats().pages<=4);assert.ok(cache.stats().bytes<=20);cache.clear();await assert.rejects(cache.get(1),/closed/);
});
test('oversized pages may display without being retained in the cache',async()=>{const cache=createPdfPageCache(async()=>new Blob(['1234567890']),{maxBytes:5});assert.equal((await cache.get(1)).size,10);assert.equal(cache.stats().bytes,0);cache.clear()});
test('2000-page scroll windows mount only visible pages plus a small overscan',()=>{
 for(const top of [0,1000,500000,1999000]){const range=pdfVisibleRange(top,700,1000,2000);assert.ok(range.first>=1);assert.ok(range.last<=2000);assert.ok(range.last-range.first+1<=5);}
 const last=pdfVisibleRange(1999000,700,1000,2000);assert.equal(last.current,2000);assert.equal(last.last,2000);
});
test('a distant page jump discards obsolete queued downloads instead of blocking the new page',async()=>{
 const loads:number[]=[];let release!:(value:Blob)=>void;
 const cache=createPdfPageCache(async p=>{loads.push(p);if(p===1)return new Promise<Blob>(resolve=>{release=resolve});return new Blob([String(p)])},{concurrency:1});
 const active=cache.get(1),old=assert.rejects(cache.get(2),/superseded/),current=cache.get(2000);
 cache.keepWindow(1999,2000);assert.equal(cache.stats().queued,1);release(new Blob(['1']));await Promise.all([active,old,current]);assert.deepEqual(loads,[1,2000]);cache.clear();
});
