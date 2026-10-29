import {normalizeSubscriberEmail} from './subscriber-email.js';
import {resolveImportWindow} from './subscriber-import-window.js';
export type SubscriberImportIssue={row:number;email:string;code:'DUPLICATE_UPLOAD'|'EXISTING_EMAIL'|'INVALID_DATES';message:string};
export type ImportRow={email:string;course?:string;activationDate?:string;expiryDate?:string};
/** Bulk creation never updates a matching identity or its subscriptions. */
export function subscriberImportIssues(rows:readonly ImportRow[],existingEmails:readonly string[],_course:{name:string;code:string},activeFrom?:string,validUntil?:string|null):SubscriberImportIssue[]{
  const existing=new Set(existingEmails.map(normalizeSubscriberEmail));
  const seen=new Map<string,number>();const issues:SubscriberImportIssue[]=[];
  for(const [index,student] of rows.entries()){
    const email=normalizeSubscriberEmail(student.email),row=index+2;
    const add=(code:SubscriberImportIssue['code'],message:string)=>issues.push({row,email,code,message});
    const first=seen.get(email);
    if(first!==undefined)add('DUPLICATE_UPLOAD',`Email is repeated in this file (first appears in row ${first}).`);
    else seen.set(email,row);
    if(existing.has(email))add('EXISTING_EMAIL','Student already exists or was imported previously. This record will be skipped; manage any changes from Subscribers.');
    if(!resolveImportWindow(student,activeFrom,validUntil))add('INVALID_DATES','Expiry must follow activation. Check this row and the default dates.');
  }
  return issues;
}
