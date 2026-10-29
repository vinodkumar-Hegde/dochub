/** A published or ready version without secure renditions is recoverable.
 * A completed version must never be re-scanned simply because it was opened.
 * Terminally failed/quarantined versions require explicit administrative action. */
export type PreviewJob = 'process' | 'repair' | 'skip' | 'terminal';
export function previewJob(state:string, previewReady:boolean, attempts:number):PreviewJob {
  if (state==='QUARANTINED'||state==='FAILED') return 'terminal';
  if (state==='DELETED'||state==='UPLOADING') return 'skip';
  if (state==='READY'||state==='PUBLISHED') {
    if (previewReady) return 'skip';
    return attempts>=5 ? 'terminal' : 'repair';
  }
  return state==='QUEUED'||state==='PROCESSING' ? 'process' : 'terminal';
}
export function publishablePreview(state:string,previewReady:boolean,pageCount:number|null):boolean {
  return state==='READY' && previewReady && Number.isSafeInteger(pageCount) && (pageCount ?? 0)>0;
}
