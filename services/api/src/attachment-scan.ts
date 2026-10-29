import {execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {AuthError} from './auth.js';
const exec=promisify(execFile);
type Scanner=(path:string)=>Promise<void>;
const execute:Scanner=async path=>{await exec('clamscan',['--no-summary','--fail-if-cvd-older-than=3',path],{timeout:90000,maxBuffer:4096})};
export async function scanNotificationAttachment(data:Buffer,scan:Scanner=execute):Promise<void>{
 const directory=await fs.mkdtemp(join(tmpdir(),'dochub-attachment-'));
 try{
  const path=join(directory,'attachment');await fs.writeFile(path,data,{mode:0o600});
  try{await scan(path)}
  catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code===1)throw new AuthError(422,'Attachment failed the malware scan.');throw new AuthError(503,'Attachment scanner unavailable. Please retry later.');}
 }finally{await fs.rm(directory,{recursive:true,force:true})}
}
