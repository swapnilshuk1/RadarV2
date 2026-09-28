import { createServerFn } from '@tanstack/react-start';
import { requireAuthUser } from '../auth/guard';
import { resolveServingScope } from '../security/scope-resolver';
import { getDatabaseAdapter } from '@/data/database';

export interface AcquisitionFeedRow {
  id:string;version:string;jobHash:string;role:string;company:string;location:string;source:string;
  state:'NOT_PURSUED'|'READY'|'PREPARING'|'PROCESSING'|'WAITING'|'NEEDS_ATTENTION'|'OUTSIDE_SEARCH';decision:string|null;
}
export const getAcquisitionFeedFn=createServerFn({method:'GET'})
  .validator((input?:{offset?:number;tenantId?:string;personId?:string})=>{
    if(Boolean(input?.tenantId)!==Boolean(input?.personId)) throw new Error('CANDIDATE_SCOPE_INCOMPLETE');
    return {offset:Math.max(0,Math.trunc(input?.offset||0)),tenantId:input?.tenantId,personId:input?.personId};
  })
  .handler(async({data})=>{
    const user=await requireAuthUser();
    const {scope,activeContext}=await resolveServingScope(user.id,data.tenantId,getDatabaseAdapter(),data.personId);
    if(!activeContext)return {rows:[] as AcquisitionFeedRow[],total:0,unadmittedCaptures:0,counts:[] as {state:string;count:number}[],nextOffset:null as number|null};
    const {readAcquisitionFeed}=await import('./server/acquisition-feed-read-model');
    return readAcquisitionFeed(getDatabaseAdapter(),scope,activeContext,data.offset);
  });
