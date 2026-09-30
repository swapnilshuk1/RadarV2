import { createServerFn } from '@tanstack/react-start';
import { requireAuthUser } from '@/lib/auth/guard';
import { resolveServingScope } from '@/lib/security/scope-resolver';
import { getDatabaseAdapter } from '@/data/database';
import type { AcquisitionFeedRow } from './contracts';
export const getAcquisitionFeedFn=createServerFn({method:'GET'})
  .validator((input?:{offset?:number;tenantId?:string;personId?:string})=>{
    if(Boolean(input?.tenantId)!==Boolean(input?.personId)) throw new Error('CANDIDATE_SCOPE_INCOMPLETE');
    return {offset:Math.max(0,Math.trunc(input?.offset||0)),tenantId:input?.tenantId,personId:input?.personId};
  })
  .handler(async({data})=>{
    const user=await requireAuthUser();
    const {scope,activeContext}=await resolveServingScope(user.id,data.tenantId,getDatabaseAdapter(),data.personId);
    if(!activeContext)return {rows:[] as AcquisitionFeedRow[],total:0,unadmittedCaptures:0,counts:[] as {state:string;count:number}[],nextOffset:null as number|null};
    const {readAcquisitionFeed}=await import('./feed-read-model');
    return readAcquisitionFeed(getDatabaseAdapter(),scope,activeContext,data.offset);
  });
