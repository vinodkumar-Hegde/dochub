import test from 'node:test';
import assert from 'node:assert/strict';
import {createChangeMonitor,type WorkspaceChange,type ChangeEvent} from '../../src/change-monitor.ts';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('subscribers share one request; unchanged revisions do not request content reloads',async()=>{
 let calls=0,resolve!:(value:WorkspaceChange)=>void;
 const monitor=createChangeMonitor(()=>{calls++;return new Promise(r=>{resolve=r})},()=>true),a:ChangeEvent[]=[],b:ChangeEvent[]=[];
 const offA=monitor.subscribe(e=>a.push(e)),offB=monitor.subscribe(e=>b.push(e));monitor.refresh();assert.equal(calls,1);
 resolve({contentVersion:'a',inboxVersion:'b',unreadCount:2});await flush();assert.equal(a[0]!.contentChanged,true);assert.equal(b[0]!.unreadCount,2);
 monitor.refresh();resolve({contentVersion:'a',inboxVersion:'b',unreadCount:2});await flush();assert.equal(a.at(-1)!.contentChanged,false);assert.equal(a.at(-1)!.inboxChanged,false);
 monitor.refresh();resolve({contentVersion:'c',inboxVersion:'b',unreadCount:2});await flush();assert.equal(a.at(-1)!.contentChanged,true);assert.equal(a.at(-1)!.inboxChanged,false);offA();offB();
});
test('hidden workspaces do not poll and unsubscribing aborts stale requests',async()=>{
 let visible=false,calls=0,signal:AbortSignal|undefined,resolve!:(value:WorkspaceChange)=>void;
 const monitor=createChangeMonitor(s=>{calls++;signal=s;return new Promise(r=>{resolve=r})},()=>visible),events:ChangeEvent[]=[];
 const off=monitor.subscribe(e=>events.push(e));assert.equal(calls,0);visible=true;monitor.refresh();assert.equal(calls,1);off();assert.equal(signal!.aborted,true);
 resolve({contentVersion:'old',inboxVersion:'old',unreadCount:99});await flush();assert.equal(events.length,0);
});
test('authorization failures notify the account gate without publishing stale state',async()=>{
 let invalidated=0;const monitor=createChangeMonitor(async()=>{throw Object.assign(new Error('Expired'),{status:403})},()=>true,()=>invalidated++);
 const off=monitor.subscribe(()=>assert.fail('No stale state'));await flush();assert.equal(invalidated,1);off();
});
