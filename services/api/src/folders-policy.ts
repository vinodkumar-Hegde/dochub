/** Visibility is fail-closed for student catalogue, detail, and signed URL access. */
export function isStudentDocumentVisible(doc:{hidden:boolean;locked:boolean;folder?:{hidden:boolean;locked:boolean}|null}):boolean {
  return !doc.hidden&&!doc.locked&&!doc.folder?.hidden&&!doc.folder?.locked;
}
