import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedWork} from './bounded-work.js';
test('bounded tasks execute exactly once without exceeding the limit',async()=>{
  let active=0,max=0;const seen:number[]=[];
  await boundedWork(Array.from({length:31},(_,i)=>i),3,async item=>{
    active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));seen.push(item);active--;
  });
  assert.equal(max,3);assert.equal(active,0);assert.deepEqual(seen.sort((a,b)=>a-b),Array.from({length:31},(_,i)=>i));
});
test('failure drains in-flight tasks and stops further scheduling',async()=>{
  const failure=new Error('render failed');let release!:()=>void;let drained=false,finished=false;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const started:number[]=[];
  const result=boundedWork([0,1,2,3],2,async item=>{
    started.push(item);if(item===0){await Promise.resolve();throw failure;}
    await gate;drained=true;
  }).catch(error=>{finished=true;assert.equal(error,failure)});
  await new Promise(resolve=>setTimeout(resolve,1));assert.equal(finished,false);assert.deepEqual(started,[0,1]);
  release();await result;assert.equal(drained,true);
});
