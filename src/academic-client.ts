import { authorizedRequest } from './auth-client';
import type { Course, Plan, Subject, Programme } from './data';

export type AcademicRecordState={revision:number;hidden:boolean;accessLocked:boolean;archivedAt:string|null};
export type AcademicFaculty=AcademicRecordState&{id:string;name:string};
export type AcademicProgramme = Programme & AcademicRecordState & { locked: boolean };
export type AcademicCatalog = {
  courses: (Course & AcademicRecordState)[];
  plans: (Plan & AcademicRecordState)[];
  subjects: (Subject & AcademicRecordState)[];
  faculty?: AcademicFaculty[];
  programmes: AcademicProgramme[];
};
export type ProgrammeContext = {
  programme: { id: string; name: string; locked: boolean; mappingRevision: number };
  courses: Array<{ id: string; name: string; code: string }>;
  plans: Array<{ id: string; name: string; courseId: string }>;
  subjects: Array<{ id: string; name: string }>;
  canPublish: boolean;
};
export type PlanProgrammes = {
  plan: { id: string; name: string; courseId: string };
  programmes: Array<{ id: string; name: string; courseId: string; locked: boolean; revision: number }>;
};
export type AcademicKind = 'Course' | 'Plan' | 'Subject' | 'Programme' | 'Faculty';
export type AcademicManageKind = 'courses'|'plans'|'subjects'|'programmes'|'faculty';
const endpoints: Record<AcademicKind,string> = {
  Course:'courses', Plan:'plans', Subject:'subjects', Programme:'programmes', Faculty:'faculty',
};
export const academicClient = {
  getCatalog: () => authorizedRequest<AcademicCatalog>('/v1/academic/catalog'),
  getProgrammeContext: (id: string) => authorizedRequest<ProgrammeContext>(`/v1/academic/programmes/${encodeURIComponent(id)}/context`),
  getPlanProgrammes: (id: string) => authorizedRequest<PlanProgrammes>(`/v1/academic/plans/${encodeURIComponent(id)}/programmes`),
  create: (kind: AcademicKind, name: string, courseId?: string) =>
    authorizedRequest<{ id: string }>(`/v1/academic/${endpoints[kind]}`, {
      method: 'POST', body: JSON.stringify(kind === 'Course' || kind === 'Subject' || kind === 'Faculty' ? { name } : { name, courseId }),
    }),
  saveMapping: (id: string, revision: number, planIds: string[], subjectIds: string[]) =>
    authorizedRequest<{ status: string }>(`/v1/academic/programmes/${encodeURIComponent(id)}/mapping`, {
      method:'PUT', body:JSON.stringify({revision,planIds,subjectIds}),
    }),
  manage: (kind:AcademicManageKind,id:string,revision:number,changes:{name?:string;hidden?:boolean;accessLocked?:boolean;archived?:boolean}) => authorizedRequest<{status:string;revision:number}>(`/v1/academic/manage/${kind}/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({revision,...changes})}),
  lockMapping: (id: string, revision: number, locked: boolean) =>
    authorizedRequest<{ status: string }>(`/v1/academic/programmes/${encodeURIComponent(id)}/lock`, {
      method:'PUT', body:JSON.stringify({revision,locked}),
    }),
};
