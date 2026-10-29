import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from './config.js';
const base={DATABASE_URL:'postgresql://localhost/test',AWS_REGION:'ap-south-1',S3_BUCKET:'test-private',SQS_QUEUE_URL:'https://sqs.ap-south-1.amazonaws.com/000000000000/test',CORS_ORIGIN:'https://learn.example.com'};
test('browser origin must be exact and trusted proxy setting is bounded',()=>{
 assert.equal(loadConfig(base).TRUST_PROXY_HOPS,0);
 for(const CORS_ORIGIN of ['https://learn.example.com/','https://user:pass@learn.example.com','ftp://learn.example.com','https://learn.example.com/path'])assert.throws(()=>loadConfig({...base,CORS_ORIGIN}));
 assert.throws(()=>loadConfig({...base,TRUST_PROXY_HOPS:'2'}));
});
test('partial private CDN setup fails closed',()=>{assert.throws(()=>loadConfig({...base,PREVIEW_CDN_ORIGIN:'https://cdn.example.com'}),/All preview CDN/)});
test('blank optional container variables remain optional',()=>{assert.equal(loadConfig({...base,PREVIEW_CDN_ORIGIN:'',PREVIEW_CDN_KEY_PAIR_ID:'',PREVIEW_CDN_PRIVATE_KEY_FILE:''}).PREVIEW_CDN_ORIGIN,undefined)});
