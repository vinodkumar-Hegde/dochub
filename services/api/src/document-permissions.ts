/** Document controls: deny download and print by default for every new PDF.
 * Share is not a supported operation. The original PDF must never be returned
 * to a restricted student reader, even via a short-lived presigned URL.
 */
export type DocumentPermissionFlags = {
  allowDownload: boolean;
  allowPrint: boolean;
};
export type FolderPermissionFlags = DocumentPermissionFlags | null | undefined;
/** Folder permissions are a maximum, never an additional grant.
 * A student needs permission from both the PDF and its parent folder.
 * Subject-root PDFs have no folder restriction beyond their own flags.
 */
export function effectiveDocumentPermissions(
  document: DocumentPermissionFlags & {folder?: FolderPermissionFlags},
): DocumentPermissionFlags {
  return {
    allowDownload: document.allowDownload && (document.folder?.allowDownload ?? true),
    allowPrint: document.allowPrint && (document.folder?.allowPrint ?? true),
  };
}
export type DocumentReaderMode = 'pdf' | 'pages';

export function canDownloadOriginal(isAdmin: boolean, flags: DocumentPermissionFlags): boolean {
  return isAdmin || flags.allowDownload;
}

export function studentReaderMode(isAdmin: boolean): DocumentReaderMode {
  return isAdmin ? 'pdf' : 'pages';
}

export function previewPageKey(versionId: string, page: number): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(versionId) || !Number.isSafeInteger(page) || page <= 0) {
    throw new Error('Invalid PDF preview version or page');
  }
  return `private/previews/${versionId}/page-${String(page).padStart(6, '0')}.jpg`;
}
