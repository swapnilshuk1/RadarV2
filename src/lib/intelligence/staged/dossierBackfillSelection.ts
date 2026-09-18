import type {DatabaseAdapter} from '@/data/database';
import {RICH_DOSSIER_VERSION} from '@/data/sqlite/repositories/SqliteRichDossierStore';

/** Shared selection seam for operator composition and publish-only regression tests. */
export async function selectStagedDossierWork(db:DatabaseAdapter,input:{context:string;limit:number;shards?:number;shard?:number;job?:string;publish?:boolean;publishOnly?:boolean}){
 const {context,limit,job}=input;
 const shards=input.shards??1,shard=input.shard??0,publishOnly=input.publishOnly??false,publish=publishOnly||input.publish===true;
 if(!context||!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(shards)||shards<1||!Number.isSafeInteger(shard)||shard<0||shard>=shards)throw new Error('DOSSIER_SELECTION_INVALID');
const missingProjection=`NOT EXISTS(SELECT 1 FROM materialized_evaluations me WHERE me.tenant_id=se.tenant_id AND me.person_id=se.person_id AND me.canonical_job_id=se.canonical_job_id AND me.opportunity_version=se.opportunity_version AND me.evaluation_context_fingerprint=se.evaluation_context_fingerprint)`;
const rows=await db.many<{tenant_id:string;person_id:string;canonical_job_id:string;opportunity_version:string;profile_version:string}>(`
  SELECT se.tenant_id,se.person_id,se.canonical_job_id,se.opportunity_version,se.profile_version FROM staged_evaluations se
  LEFT JOIN materialized_dossier_presentations p ON p.tenant_id=se.tenant_id AND p.person_id=se.person_id
    AND p.canonical_job_id=se.canonical_job_id AND p.opportunity_version=se.opportunity_version
    AND p.evaluation_context_fingerprint=se.evaluation_context_fingerprint AND p.presentation_version=?
    AND json_extract(p.presentation_json,'$.sourceInputFingerprint')=se.input_fingerprint
    AND p.source_evaluation_fingerprint=json_extract(p.presentation_json,'$.sourceEvaluationFingerprint')
  WHERE se.evaluation_context_fingerprint=? AND se.evaluation_state='COMPLETED'
    AND unicode(substr(se.canonical_job_id,1,1)) % ? = ?
    ${job?'AND se.canonical_job_id=?':''}
    AND ${publishOnly?'p.presentation_json IS NOT NULL AND '+missingProjection:'(p.presentation_json IS NULL'+(publish?' OR '+missingProjection:'')+')'}
  ORDER BY CASE WHEN se.decision='PURSUE' THEN 0 WHEN se.decision='CONSIDER' THEN 1 ELSE 2 END,se.canonical_job_id LIMIT ?`,
  [RICH_DOSSIER_VERSION,context,shards,shard,...(job?[job]:[]),limit]);
 return rows;
}
