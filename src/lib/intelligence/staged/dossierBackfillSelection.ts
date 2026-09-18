import type {DatabaseAdapter} from '@/data/database';
import {stagedDossierHealth} from './stagedDossierHealth';

/** Validate exact outputs before selecting work; SQL JSON self-agreement is insufficient. */
export async function selectStagedDossierWork(db:DatabaseAdapter,input:{context:string;limit:number;shards?:number;shard?:number;job?:string;publish?:boolean;publishOnly?:boolean}){
 const {context,limit,job}=input;
 const shards=input.shards??1,shard=input.shard??0,publishOnly=input.publishOnly??false,publish=publishOnly||input.publish===true;
 if(!context||!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(shards)||shards<1||!Number.isSafeInteger(shard)||shard<0||shard>=shards)throw new Error('DOSSIER_SELECTION_INVALID');
 type Row={tenant_id:string;person_id:string;canonical_job_id:string;opportunity_version:string;profile_version:string};
 const selected:Row[]=[];
 // Page the ordered cohort so an early valid dossier cannot hide later missing work.
 for(let offset=0;;offset+=100){
  const rows=await db.many<Row>(`SELECT tenant_id,person_id,canonical_job_id,opportunity_version,profile_version FROM staged_evaluations
   WHERE evaluation_context_fingerprint=? AND evaluation_state='COMPLETED' AND decision IN ('PURSUE','CONSIDER') AND unicode(substr(canonical_job_id,1,1)) % ? = ?
   ${job?'AND canonical_job_id=?':''}
   ORDER BY CASE decision WHEN 'PURSUE' THEN 0 WHEN 'CONSIDER' THEN 1 ELSE 2 END,canonical_job_id,opportunity_version LIMIT 100 OFFSET ?`,[context,shards,shard,...(job?[job]:[]),offset]);
  for(const row of rows){
   const health=await stagedDossierHealth(db,{tenantId:row.tenant_id,personId:row.person_id,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,profileVersion:row.profile_version,evaluationContextFingerprint:context});
   if(publishOnly?health.dossier&&!health.published:!health.dossier||(publish&&!health.published))selected.push(row);
   if(selected.length===limit)return selected;
  }
  if(rows.length<100)return selected;
 }
}
