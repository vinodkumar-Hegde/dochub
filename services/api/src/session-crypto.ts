import {createHash,randomBytes} from 'node:crypto';
export const digestSecret=(value:string)=>createHash('sha256').update(value).digest('hex');
export const freshSecret=()=>randomBytes(32).toString('base64url');
