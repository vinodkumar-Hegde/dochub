import type {DocumentPermissionFlags} from './document-permissions.js';
/** Print and download are distinct, administrator-managed grants. */
export function canExportStudentPdf(purpose:'download'|'print',permissions:DocumentPermissionFlags):boolean{
  return purpose==='download'?permissions.allowDownload:permissions.allowPrint;
}
