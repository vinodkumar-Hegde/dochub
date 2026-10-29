export const folderColors = ['blue', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
export type FolderColor = (typeof folderColors)[number];

export type MoveSource = {
  id: string;
  revision: number;
  courseId: string;
  programmeId: string;
  subjectId: string;
  folderId: string | null;
  canManage: boolean;
  locked: boolean;
};
export type MoveDestination = {
  id: string | null;
  courseId: string;
  programmeId: string;
  subjectId: string;
  locked: boolean;
};

/** Client convenience only: the Fastify route independently enforces all constraints. */
export function canMoveTo(source: MoveSource | null, destination: MoveDestination): boolean {
  return Boolean(source && source.canManage && !source.locked && !destination.locked &&
    source.courseId === destination.courseId &&
    source.programmeId === destination.programmeId &&
    source.subjectId === destination.subjectId &&
    (source.folderId ?? null) !== destination.id);
}
