import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {scanNotificationAttachment} from './attachment-scan.js';
test('attachment scan uses a private temporary file and removes it after success',async()=>{
 let path='';await scanNotificationAttachment(Buffer.from('safe'),async value=>{path=value;assert.equal((await fs.readFile(value)).toString(),'safe');assert.equal((await fs.stat(value)).mode&0o777,0o600)});await assert.rejects(fs.stat(path),{code:'ENOENT'});
});
test('malware and unavailable scanners fail closed and remove temporary data',async()=>{
 for(const code of [1,2,'ENOENT']){let path='';await assert.rejects(scanNotificationAttachment(Buffer.from('test'),async value=>{path=value;throw Object.assign(new Error('scanner failure'),{code})}),{statusCode:code===1?422:503});await assert.rejects(fs.stat(path),{code:'ENOENT'});}
});
