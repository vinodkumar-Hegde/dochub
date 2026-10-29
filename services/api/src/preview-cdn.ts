import {readFileSync} from 'node:fs';
import {createPrivateKey} from 'node:crypto';
import {getSignedUrl} from '@aws-sdk/cloudfront-signer';
import type {Config} from './config.js';
import {previewPageKey} from './document-permissions.js';
export type PreviewDelivery={baseUrl:string;query:string;expiresAt:number};

/** Opt-in delivery of rendered JPEGs only, never the original document.
 * Entitlements must be checked before issuing each short-lived version grant. */
export function createPreviewDeliverySigner(cfg:Config):((versionId:string)=>PreviewDelivery)|undefined{
  if(!cfg.PREVIEW_CDN_ORIGIN)return undefined;
  const key=readFileSync(cfg.PREVIEW_CDN_PRIVATE_KEY_FILE!,'utf8');
  const parsed=createPrivateKey(key);
  if(parsed.asymmetricKeyType!=='rsa'||(parsed.asymmetricKeyDetails?.modulusLength??0)!==2048)throw new Error('CloudFront signing requires a 2048-bit RSA key');
  return versionId=>signPreviewDelivery(cfg.PREVIEW_CDN_ORIGIN!,cfg.PREVIEW_CDN_KEY_PAIR_ID!,key,versionId,cfg.PREVIEW_CDN_TTL_SECONDS);
}
export function signPreviewDelivery(origin:string,keyPairId:string,key:string,versionId:string,ttl:number,now=Date.now()):PreviewDelivery{
  if(!Number.isInteger(ttl)||ttl<15||ttl>120)throw new Error('Invalid CDN grant lifetime');
  const firstKey=previewPageKey(versionId,1);
  const baseUrl=`${origin.replace(/\/$/,'')}/${firstKey.slice(0,firstKey.lastIndexOf('/')+1)}`;
  const expiresAt=(Math.floor(now/1000)+ttl)*1000;
  const policy=JSON.stringify({Statement:[{Resource:`${baseUrl}*`,Condition:{DateLessThan:{'AWS:EpochTime':expiresAt/1000}}}]});
  const signed=getSignedUrl({url:`${baseUrl}*`,keyPairId,privateKey:key,policy});
  return {baseUrl,query:new URL(signed).search,expiresAt};
}
