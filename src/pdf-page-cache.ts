/** LRU page cache with bounded bytes, entry count and concurrent decoding/fetching. */
export function createPdfPageCache(load:(page:number)=>Promise<Blob>,options:{maxPages?:number;maxBytes?:number;concurrency?:number}={}){
 const maxPages=options.maxPages??10,maxBytes=options.maxBytes??24*1024*1024,concurrency=options.concurrency??2;
 if(![maxPages,maxBytes,concurrency].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Invalid page cache bounds');
 const entries=new Map<number,Blob>(),pending=new Map<number,Promise<Blob>>();
 const queue:Array<{page:number;resolve:(blob:Blob)=>void;reject:(error:unknown)=>void}>=[];
 let bytes=0,active=0,disposed=false;
 const pump=()=>{
  while(!disposed&&active<concurrency&&queue.length){const job=queue.shift()!;active++;
   void load(job.page).then(blob=>{
    if(disposed)throw new Error('Reader closed');
    if(blob.size<=maxBytes){entries.set(job.page,blob);bytes+=blob.size;while(entries.size>maxPages||bytes>maxBytes){const oldest=entries.keys().next().value!;bytes-=entries.get(oldest)!.size;entries.delete(oldest)}}
    job.resolve(blob);
   }).catch(job.reject).finally(()=>{active--;pending.delete(job.page);pump()});
  }
 };
 return {
  get(page:number):Promise<Blob>{
   if(disposed)return Promise.reject(new Error('Reader closed'));
   if(!Number.isSafeInteger(page)||page<1)return Promise.reject(new Error('Invalid page'));
   const cached=entries.get(page);if(cached){entries.delete(page);entries.set(page,cached);return Promise.resolve(cached)}
   const inFlight=pending.get(page);if(inFlight)return inFlight;
   const promise=new Promise<Blob>((resolve,reject)=>queue.push({page,resolve,reject}));pending.set(page,promise);pump();return promise;
  },
  prefetch(page:number){if(page>=1)void this.get(page).catch(()=>{})},
  keepWindow(first:number,last:number){
   // Drop obsolete queued work after a fast jump; at most existing active loads finish.
   for(let i=queue.length-1;i>=0;i--){const job=queue[i]!;if(job.page<first||job.page>last){queue.splice(i,1);pending.delete(job.page);job.reject(new Error('Page request superseded by navigation'))}}
  },
  clear(){disposed=true;entries.clear();pending.clear();bytes=0;for(const job of queue.splice(0))job.reject(new Error('Reader closed'));},
  stats(){return {pages:entries.size,bytes,active,queued:queue.length}},
 };
}
export function pdfVisibleRange(scrollTop:number,height:number,stride:number,pageCount:number){
 const first=Math.max(1,Math.min(pageCount,Math.floor(Math.max(0,scrollTop)/stride)+1));
 const last=Math.min(pageCount,Math.ceil((Math.max(0,scrollTop)+height)/stride));
 return {first:Math.max(1,first-1),last:Math.min(pageCount,last+2),current:Math.max(1,Math.min(pageCount,Math.floor((scrollTop+height*.25)/stride)+1))};
}
