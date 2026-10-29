/** Stop scheduling after failure, but drain all in-flight work before cleanup. */
export async function boundedWork<T>(items:readonly T[], concurrency:number, work:(item:T)=>Promise<void>):Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  let next=0, failed=false;
  let failure:unknown;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(!failed && next<items.length){
      const item=items[next++]!;
      try {await work(item);} catch(error){if(!failed){failed=true;failure=error;}}
    }
  }));
  if(failed)throw failure;
}
