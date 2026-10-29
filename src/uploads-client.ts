import { authorizedRequest } from './auth-client';

export type DocumentStatus = 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'QUARANTINED' | 'DELETED';
export type DocumentRow = {
  id: string;
  title: string;
  courseId: string;
  programmeId: string;
  subjectId: string;
  folderId: string|null; hidden:boolean;locked:boolean;allowDownload:boolean;allowPrint:boolean;revision:number;
  planIds: string[];
  status: DocumentStatus;
  createdAt: string;
  canManage: boolean;
  latestVersion: null | {
    id: string;
    number: number;
    state: DocumentStatus;
    pageCount: number | null;
    canPublish: boolean;
    publishWhenReady: boolean;
    publicationFailure: string|null;
    failureReason: string | null;
    sizeBytes: string;
    processingAttempt: number;
    createdAt: string;
  };
};
export type PreviewDelivery = {baseUrl:string;query:string;expiresAt:number};
export type DocumentReadResult = {mode:'pdf';pagePreviewReady?:boolean;url:string;versionId:string;pageCount:number|null;expiresInSeconds:number} | {mode:'pages';watermark?:{position:string;color:string;opacity:number;rotation:number;fontSize:number};versionId:string;pageCount:number;allowDownload:boolean;allowPrint:boolean;delivery?:PreviewDelivery};
export type StudyStroke = {id:string;kind:'pen'|'highlighter';color:string;width:number;points:Array<[number,number]>};
export type StudySummary = {email:string;pages:Array<{page:number;isRead:boolean;hasInk:boolean}>};
export type StudyPage = {page:number;isRead:boolean;revision:number;strokes:StudyStroke[]};
export type DocumentPage = { items: DocumentRow[]; nextCursor: string | null; total: number; publishedTotal: number };
export type UploadSelection = { title: string; courseId?: string; programmeId: string; subjectId: string; planIds: string[]; mappingRevision?: number; folderId?:string|null };
export type StudentMaterial = {
  id: string; folderId:string|null;
  title: string;
  courseId: string;
  courseName: string;
  programmeId: string;
  programmeName: string;
  subjectId: string;
  subjectName: string;
  pageCount: number | null;
};
export type StudentCatalogue = { programmes: Array<{
  id: string; name: string; courseId: string; courseName: string;
  subjects: Array<{ id: string; name: string }>;
}> };
export type StudentMaterialsPage = { items: StudentMaterial[]; nextCursor: string | null };
type UploadSession = { documentId: string; versionId: string; uploadId: string };
type UploadPolicy = { maxPdfBytes: number; partBytes: number };

const api = <T,>(path: string, method = 'GET', body?: unknown) =>
  authorizedRequest<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const documentApi = {
  list: (args: { courseId?: string; programmeId?: string; subjectId?:string; folderId?:string; query?: string; cursor?: string }) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) if (value) q.set(key, value);
    return api<DocumentPage>(`/v1/documents?${q}`);
  },
  publicationIntent:(id:string,versionId:string,enabled:boolean)=>api<{status:string}>(`/v1/documents/${id}/publication-intent`,'PUT',{versionId,enabled}),
  read: (id: string) => api<DocumentReadResult>(`/v1/documents/${id}/read`),
  studySummary:(id:string,versionId:string)=>api<StudySummary>(`/v1/documents/${id}/study?${new URLSearchParams({versionId})}`),
  studyPage:(id:string,versionId:string,page:number)=>api<StudyPage>(`/v1/documents/${id}/study/pages/${page}?${new URLSearchParams({versionId})}`),
  studyInk:(id:string,versionId:string,page:number,revision:number,strokes:StudyStroke[])=>api<{page:number;revision:number;isRead:boolean}>(`/v1/documents/${id}/study/pages/${page}?${new URLSearchParams({versionId})}`,'PUT',{revision,strokes}),
  markStudyPage:(id:string,versionId:string,page:number,isRead:boolean)=>api<{page:number;revision:number;isRead:boolean}>(`/v1/documents/${id}/study/pages/${page}/read?${new URLSearchParams({versionId})}`,'PATCH',{isRead}),

  download: (id: string) => api<{url:string;expiresInSeconds:number}>(`/v1/documents/${id}/download`),
  studentCatalogue: () => api<StudentCatalogue>('/v1/student/catalogue'),
  studentFolders:(programmeId:string,subjectId:string)=>api<{items:Array<{id:string;name:string}>}>(`/v1/student/folders?${new URLSearchParams({programmeId,subjectId})}`),
  studentMaterials: (cursor?: string) => api<StudentMaterialsPage>(`/v1/student/materials${cursor ? `?${new URLSearchParams({cursor})}` : ''}`),
  policy: () => api<UploadPolicy>('/v1/documents/upload-policy'),
  publish: (id: string) => api<{status:DocumentStatus}>(`/v1/documents/${id}/publish`, 'POST'),
  retry: (id: string, versionId: string) => api<{status:DocumentStatus}>(`/v1/documents/${id}/versions/${versionId}/retry`, 'POST'),
  remove: (id: string) => api<{status:DocumentStatus}>(`/v1/documents/${id}`, 'DELETE'),
  abort: (id: string, versionId: string) => api<{status:DocumentStatus}>(`/v1/documents/${id}/versions/${versionId}/abort`, 'POST'),
};

function putPart(url: string, blob: Blob, signal: AbortSignal, progress: (bytes: number) => void): Promise<string> {
  return new Promise((resolve,reject) => {
    const xhr = new XMLHttpRequest();
    let finished = false;
    const abort = () => xhr.abort();
    const cleanup = () => { signal.removeEventListener('abort', abort); };
    const done = (error?: Error, eTag?: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else if (eTag) resolve(eTag);
      else reject(new Error('S3 did not return an ETag; check the bucket CORS ExposeHeaders setting'));
    };
    xhr.open('PUT', url);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.min(blob.size, event.loaded)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? done(undefined, xhr.getResponseHeader('ETag') ?? undefined)
      : done(new Error(`S3 upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => done(new Error('S3 upload connection failed'));
    xhr.ontimeout = () => done(new Error('S3 upload timed out'));
    xhr.onabort = () => done(new Error('Upload cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { xhr.abort(); done(new Error('Upload cancelled')); return; }
    xhr.send(blob);
  });
}

export async function uploadPdf(
  selection: UploadSelection,
  file: File,
  onProgress: (value: number) => void,
  signal: AbortSignal,
  replacementId?: string,
): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Select a PDF file');
  const policy = await documentApi.policy();
  if (file.size <= 0 || file.size > policy.maxPdfBytes) throw new Error('PDF exceeds the allowed file size');
  if (policy.partBytes < 5 * 1024 * 1024) throw new Error('Invalid server multipart configuration');
  const path = replacementId ? `/v1/documents/${replacementId}/versions` : '/v1/documents/uploads';
  const session = await api<UploadSession>(path, 'POST', replacementId
    ? { sizeBytes: file.size }
    : { ...selection, sizeBytes: file.size });
  const count = Math.ceil(file.size / policy.partBytes);
  const uploaded = Array<number>(count).fill(0);
  const completed: { partNumber: number; eTag: string }[] = [];
  let next = 0;
  let failed: Error | undefined;
  const uploadWorker = async () => {
    while (next < count && !failed && !signal.aborted) {
      const index = next++;
      const partNumber = index + 1;
      const chunk = file.slice(index * policy.partBytes, Math.min(file.size, partNumber * policy.partBytes));
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal.aborted) break;
        try {
          const { url } = await api<{url:string}>(`/v1/documents/${session.documentId}/versions/${session.versionId}/parts/${partNumber}/sign`, 'POST');
          const eTag = await putPart(url, chunk, signal, bytes => {
            uploaded[index] = bytes;
            onProgress(Math.min(99, Math.floor(uploaded.reduce((sum, n) => sum + n, 0) / file.size * 100)));
          });
          uploaded[index] = chunk.size;
          completed.push({ partNumber, eTag });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Part upload failed');
          uploaded[index] = 0;
          if (attempt < 3 && !signal.aborted) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
      if (lastError) { failed = lastError; break; }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3,count) }, () => uploadWorker()));
    if (signal.aborted) throw new Error('Upload cancelled');
    if (failed) throw failed;
    if (completed.length !== count) throw new Error('Upload did not finish all parts');
    await api(`/v1/documents/${session.documentId}/versions/${session.versionId}/complete`, 'POST', {
      parts: completed.sort((a,b) => a.partNumber - b.partNumber),
    });
    onProgress(100);
  } catch (error) {
    // Avoid orphaned uploads and stale UPLOADING rows after any transfer failure.
    await documentApi.abort(session.documentId, session.versionId).catch(() => {});
    throw error;
  }
}
