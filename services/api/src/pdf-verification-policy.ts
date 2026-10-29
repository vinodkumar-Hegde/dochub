/** Reuse only verification of the same immutable object under the same policy. */
export function reusablePdfVerification(v:{objectVersionId:string|null;verifiedObjectVersionId:string|null;verifiedAt:Date|null;verificationPolicy:string|null;pageCount:number|null},policy:string):boolean{
  return Boolean(v.objectVersionId && v.objectVersionId!=='null' && v.verifiedObjectVersionId===v.objectVersionId && v.verifiedAt && v.verificationPolicy===policy && Number.isSafeInteger(v.pageCount) && (v.pageCount??0)>0);
}
