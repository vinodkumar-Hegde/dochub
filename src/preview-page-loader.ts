import type {DocumentReadResult,PreviewDelivery} from './uploads-client';

/** One grant/renewal shared by the current page and visible thumbnails. */
export function createPreviewPageLoader(documentId:string,versionId:string,initial:PreviewDelivery|undefined, dependencies:{read:(id:string)=>Promise<DocumentReadResult>;fallback:(path:string)=>Promise<Blob>;fetch?:typeof fetch;now?:()=>number}){
  const request=dependencies.fetch??fetch;
  const now=dependencies.now??Date.now;
  let delivery=initial;
  let renewal:Promise<void>|undefined;
  const renew=async()=>{
    if(!renewal)renewal=(async()=>{
      const reader=await dependencies.read(documentId);
      if(reader.mode!=='pages'||reader.versionId!==versionId)throw new Error('The published PDF changed. Reopen it to continue.');
      delivery=reader.delivery;
    })().finally(()=>{renewal=undefined});
    await renewal;
  };
  return async (page:number):Promise<Blob>=>{
    if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid page');
    if(delivery&&delivery.expiresAt<=now()+5000)await renew();
    if(!delivery)return dependencies.fallback(`/v1/documents/${documentId}/preview/pages/${page}?${new URLSearchParams({versionId})}`);
    for(let attempt=0;attempt<2;attempt++){
      const grant=delivery;
      if(!grant)break;
      const url=new URL(`page-${String(page).padStart(6,'0')}.jpg${grant.query}`,grant.baseUrl);
      if(url.protocol!=='https:')throw new Error('Invalid protected delivery configuration');
      const response=await request(url,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(response.status===403&&attempt===0){await renew();continue;}
      if(!response.ok)throw new Error('Protected page delivery is unavailable. Please reopen the document.');
      if(!(response.headers.get('content-type')??'').startsWith('image/jpeg'))throw new Error('Unexpected preview content type');
      return response.blob();
    }
    return dependencies.fallback(`/v1/documents/${documentId}/preview/pages/${page}?${new URLSearchParams({versionId})}`);
  };
}
