import { authorizedRequest } from './auth-client';

export type SubscriberGrant = {
  courseId: string; programmeId: string; subjectId: string; planId: string; activeFrom?: string; validUntil: string|null;
};
export type Subscriber = {
  id: string; email: string|null; phone?: string|null; displayName: string|null; enabled: boolean;
  revision: number; status?:'ACTIVE'|'SCHEDULED'|'EXPIRED'|'LOCKED'; grants: SubscriberGrant[];
};
export type SubscriberPage = {items:Subscriber[];total:number;nextCursor:string|null};
export type SubscriberSummary = {total:number;active:number;byCourse:Record<string,number>};
export const subscribersClient = {
  list: (q?:string,cursor?:string,courseId?:string,planId?:string) => authorizedRequest<SubscriberPage>(
    `/v1/admin/subscribers?${new URLSearchParams({...q?{q}:{},...cursor?{cursor}:{},...courseId?{courseId}:{},...planId?{planId}:{},limit:'25'})}`),
  summary: () => authorizedRequest<SubscriberSummary>('/v1/admin/subscribers/summary'),
  create: (input:{email:string;displayName:string;phone?:string;grants:SubscriberGrant[]}) => authorizedRequest<{id:string;newSubscriber:boolean;assigned:number}>(
    '/v1/admin/subscribers',{method:'POST',body:JSON.stringify(input)}),
  save: (user:Subscriber,grants:SubscriberGrant[]) => authorizedRequest<{status:string}>(
    `/v1/admin/subscribers/${encodeURIComponent(user.id)}/enrollments`,{
      method:'PUT',body:JSON.stringify({revision:user.revision,grants}),
    }),
  importStudents: (input:{courseId:string;programmeId:string;subjectIds:string[];planIds:string[];activeFrom?:string;validUntil:string|null;rows:Array<{name:string;email:string;phone?:string;course?:string;activationDate?:string;expiryDate?:string}>;replaceExisting?:boolean}) =>
    authorizedRequest<{created:number;updated:number;grantsAdded:number;grantsUpdated:number;rows:number}>('/v1/admin/subscribers/import',{method:'POST',body:JSON.stringify(input)}),
  bulkAssign: (userIds:string[],grants:SubscriberGrant[]) => authorizedRequest<{status:string;updated:number}>(
    '/v1/admin/subscribers/bulk-assign',{method:'POST',body:JSON.stringify({userIds,grants})}),
};
