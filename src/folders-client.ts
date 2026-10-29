import type { FolderColor } from './folder-interactions';
import {authorizedRequest} from './auth-client';
export type FolderRow={id:string;name:string;color:FolderColor;courseId:string;programmeId:string;subjectId:string;hidden:boolean;locked:boolean;allowDownload:boolean;allowPrint:boolean;revision:number;_count:{documents:number}};
const api=<T,>(path:string,method='GET',body?:unknown)=>authorizedRequest<T>(path,{method,...body===undefined?{}:{body:JSON.stringify(body)}});
export const folderApi={
  list:(courseId:string,programmeId:string,subjectId:string)=>api<{items:FolderRow[]}>(`/v1/admin/folders?${new URLSearchParams({courseId,programmeId,subjectId})}`),
  create:(courseId:string,programmeId:string,subjectId:string,name:string,color:FolderColor)=>api<{id:string}>('/v1/admin/folders','POST',{courseId,programmeId,subjectId,name,color}),
  update:(folder:FolderRow,changes:{name?:string;color?:FolderColor;hidden?:boolean;locked?:boolean;allowDownload?:boolean;allowPrint?:boolean})=>api<{status:string}>(`/v1/admin/folders/${folder.id}`,'PATCH',{revision:folder.revision,...changes}),
  copyFolder:(id:string,name:string)=>api<{id:string;copied:number}>(`/v1/admin/folders/${id}/copy`,'POST',{name}),
  organize:(id:string,revision:number,changes:{folderId?:string|null;hidden?:boolean;locked?:boolean;allowDownload?:boolean;allowPrint?:boolean})=>api<{status:string}>(`/v1/admin/documents/${id}/organize`,'PATCH',{revision,...changes}),
  copyDocument:(id:string,folderId:string|null)=>api<{id:string}>(`/v1/admin/documents/${id}/copy`,'POST',{folderId}),
};
