import test from 'node:test';
import assert from 'node:assert/strict';
import {planPreviewBatches} from './document-preview-render.js';

test('single page is rendered exactly once', () => {
  assert.deepEqual(planPreviewBatches(1), [[1,1]]);
});
test('boundary pages do not get duplicated or skipped', () => {
  assert.deepEqual(planPreviewBatches(25), [[1,12],[13,24],[25,25]]);
});
test('215 pages are fully covered', () => {
  const b = planPreviewBatches(215);
  assert.deepEqual(b.at(-1), [205,215]);
  assert.equal(b.reduce((sum,[lo,hi]) => sum + hi-lo+1,0), 215);
});
test('2015 pages have complete coverage, beyond previous frontend cap', () => {
  const b = planPreviewBatches(2015);
  assert.deepEqual(b.at(-1), [2005,2015]);
  assert.equal(b.reduce((sum,[lo,hi]) => sum + hi-lo+1,0), 2015);
});
test('invalid page count fails closed', () => {
  for (const pages of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => planPreviewBatches(pages));
  }
});

// Exercise real Poppler rendering with isolated parallel batch directories.
import {createPrivatePagePreviews} from './document-preview-render.js';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {S3Client} from '@aws-sdk/client-s3';
function blankPdf(pages:number):Buffer{
 const objects:string[]=[];
 objects.push('<< /Type /Catalog /Pages 2 0 R >>');
 objects.push(`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${i+3} 0 R`).join(' ')}] >>`);
 for(let i=0;i<pages;i++)objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>');
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(pdf);
}
test('real parallel rendering uploads every page once and drains temporary batches',async()=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'docusend-render-test-'));
 const keys:string[]=[];let active=0,max=0;
 const s3={send:async(command:{input:{Key:string;Body:Buffer}})=>{
  active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(command.input.Body[0],0xff);assert.equal(command.input.Body[1],0xd8);
  keys.push(command.input.Key);active--;return {};
 }} as unknown as S3Client;
 try{
  const pdf=join(dir,'input.pdf');await fs.writeFile(pdf,blankPdf(25));
  await createPrivatePagePreviews(s3,'private-bucket',pdf,dir,'12345678-1234-4234-8234-123456789abc',25,{renderConcurrency:2,uploadConcurrency:2});
  assert.equal(keys.length,25);assert.equal(new Set(keys).size,25);assert.ok(max<=4);
  assert.ok(keys.some(key=>key.endsWith('page-000025.jpg')));
  assert.deepEqual(await fs.readdir(dir),['input.pdf']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
