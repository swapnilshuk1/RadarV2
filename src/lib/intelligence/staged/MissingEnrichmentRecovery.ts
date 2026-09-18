import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import type { BlobStore } from '@/lib/storage/blob-store';
import type { DetailedCard, PortalName } from '../../../../scripts/scraper/types';
import { EnrichmentQueue } from '../../../../scripts/scraper/persist/queue';
import { assertCanonicalJdContentHash } from './ProductionStagedInputAdapter';

export interface RecoveryScope {tenantId:string;personId:string;searchPlanId:string;contextFingerprint:string;}
export interface RecoverableVersion {
  canonical_job_id:string;opportunity_version:string;source:string;source_job_id:string;canonical_url:string;
  raw_content:string;job_title:string;company_name:string|null;location:string|null;employment_type:string|null;
  content_hash:string;created_at:string;source_payload_key:string|null;source_media_type:string|null;
}

/** Explicit operator recovery, separate from the normal terminal dependency lifecycle. */
export class MissingEnrichmentRecovery {
  constructor(private readonly db:DatabaseAdapter,private readonly blobs:BlobStore) {}

  async select(scope:RecoveryScope,limit:number,excludeSourceVersion?:string):Promise<RecoverableVersion[]> {
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error('RECOVERY_LIMIT_INVALID');
    return this.db.many<RecoverableVersion>(`SELECT spc.canonical_job_id,spc.opportunity_version,co.source,co.source_job_id,co.canonical_url,
      ov.raw_content,ov.job_title,ov.company_name,ov.location,ov.employment_type,ov.content_hash,ov.created_at,ov.source_payload_key,ov.source_media_type
      FROM search_plan_candidates spc JOIN canonical_opportunities co ON co.id=spc.canonical_job_id
      JOIN opportunity_versions ov ON ov.id=spc.opportunity_version AND ov.canonical_job_id=spc.canonical_job_id
      WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE'
        AND ov.acquisition_status='ACQUIRED' AND ov.lifecycle_state='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM enrichment_jobs en WHERE en.canonical_job_id=spc.canonical_job_id AND en.opportunity_version=spc.opportunity_version AND en.pipeline_version='1.0.0')
        ${excludeSourceVersion?'AND ov.raw_content<>(SELECT raw_content FROM opportunity_versions WHERE id=?)':''}
      ORDER BY spc.canonical_job_id,spc.opportunity_version LIMIT ?`,[scope.tenantId,scope.personId,scope.searchPlanId,...(excludeSourceVersion?[excludeSourceVersion]:[]),limit]);
  }

  async enqueue(version:RecoverableVersion):Promise<{jobId:string;created:boolean;payloadKey:string}> {
    assertCanonicalJdContentHash(version);
    if(!version.raw_content.trim())throw new Error('RECOVERY_SOURCE_EMPTY');
    if(!['LinkedIn','Indeed','Naukri'].includes(version.source))throw new Error('RECOVERY_PORTAL_UNSUPPORTED');
    const suffix=createHash('sha256').update(`${version.canonical_job_id}:${version.opportunity_version}:1.0.0`).digest('hex');
    const jobId=`enrich_recovery_${suffix.slice(0,24)}`;
    const payloadKey=`snapshots/recovery/${suffix}.json`;
    // This is a reconstruction of the persisted capture, never a new network acquisition.
    const card:DetailedCard={cardHash:version.source_job_id,sourceJobId:version.source_job_id,portal:version.source as PortalName,
      keyword:'historical-source-recovery',searchUrl:'',detailUrl:version.canonical_url,discoveredAt:version.created_at,
      title:version.job_title,company:version.company_name||'',location:version.location||'',rawHtml:'',rawText:version.raw_content,
      snapshotSchemaVersion:'1.0.0',scraperVersion:'persisted-source-recovery-v1',
      canonicalJobId:version.canonical_job_id,opportunityVersion:version.opportunity_version,
      detail:{fetched:true,rawText:version.raw_content},
      evaluationEvidence:{state:'BOUND',canonicalJobId:version.canonical_job_id,opportunityVersion:version.opportunity_version,
        contentHash:version.content_hash,sourcePayloadKey:version.source_payload_key,sourceMediaType:version.source_media_type},
      telemetry:{cardExtractMs:0,detailExtractMs:0,totalMs:0}};
    const payload=JSON.stringify(card);
    const existing=await this.blobs.get(payloadKey);
    if(existing&&existing.toString('utf8')!==payload)throw new Error('RECOVERY_PAYLOAD_CONFLICT');
    if(!existing)await this.blobs.put(payloadKey,payload,'application/json');
    if((await this.blobs.get(payloadKey))?.toString('utf8')!==payload)throw new Error('RECOVERY_PAYLOAD_NOT_READABLE');
    const created=await new EnrichmentQueue(this.db).enqueue(jobId,version.source_job_id,payloadKey,'1.0.0',{
      runId:'',executionPlanId:'historical-source-recovery-v1',definitionId:'historical-source-recovery-v1',familyId:'historical-source-recovery',
      portal:version.source,page:0,catalogVersion:'historical',plannerVersion:'historical',ruleVersion:'historical',searchQuery:'',
    },0,0,payloadKey,version.canonical_job_id,version.opportunity_version);
    if(created)await this.db.execute(`INSERT INTO enrichment_events(job_id,event_type,details) VALUES(?,'SOURCE_PAYLOAD_RECONSTRUCTED',?)`,[jobId,JSON.stringify({canonicalJobId:version.canonical_job_id,opportunityVersion:version.opportunity_version,contentHash:version.content_hash,source:'opportunity_versions.raw_content',networkFetch:false,payloadKey})]);
    return {jobId,created,payloadKey};
  }

  async recoverCompletedDependencies(scope:RecoveryScope):Promise<number> {
    return this.db.transaction(async tx=>{
      const rows=await tx.many<{requirement_id:string;enrichment_job_id:string;evaluation_job_id:string;job_status:string;last_error:string|null;attempts:number}>(`SELECT er.id AS requirement_id,en.id AS enrichment_job_id,ej.id AS evaluation_job_id,ej.status AS job_status,ej.last_error,ej.attempts
        FROM evaluation_requirements er JOIN enrichment_jobs en ON en.canonical_job_id=er.canonical_job_id AND en.opportunity_version=er.opportunity_version AND en.pipeline_version=er.required_enrichment_pipeline_version AND en.status='COMPLETE'
        JOIN evaluation_jobs ej ON ej.tenant_id=er.tenant_id AND ej.person_id=er.person_id AND ej.search_plan_id=er.search_plan_id AND ej.canonical_job_id=er.canonical_job_id AND ej.opportunity_version=er.opportunity_version AND ej.evaluation_context_fingerprint=er.evaluation_context_fingerprint
        WHERE er.tenant_id=? AND er.person_id=? AND er.search_plan_id=? AND er.evaluation_context_fingerprint=?
          AND er.status='FAILED' AND er.blocked_reason='MISSING_ENRICHMENT_JOB' AND ej.status IN ('staged_waiting_enrichment','staged_dead_letter')
          AND EXISTS(SELECT 1 FROM evaluation_contexts ec WHERE ec.context_fingerprint=er.evaluation_context_fingerprint AND ec.policy_version IN ('staged-v6','staged-v7'))
          AND NOT EXISTS(SELECT 1 FROM staged_evaluations se WHERE se.tenant_id=er.tenant_id AND se.person_id=er.person_id AND se.canonical_job_id=er.canonical_job_id AND se.opportunity_version=er.opportunity_version AND se.evaluation_context_fingerprint=er.evaluation_context_fingerprint)`,[scope.tenantId,scope.personId,scope.searchPlanId,scope.contextFingerprint]);
      for(const row of rows){
        await tx.execute(`INSERT INTO enrichment_events(job_id,event_type,details) VALUES(?,'EVALUATION_DEPENDENCY_RECOVERED',?)`,[row.enrichment_job_id,JSON.stringify({...row,previousRequirementStatus:'FAILED',previousBlockedReason:'MISSING_ENRICHMENT_JOB',contextFingerprint:scope.contextFingerprint})]);
        await tx.execute(`UPDATE evaluation_requirements SET status='READY',blocked_reason=NULL,ready_at=CURRENT_TIMESTAMP WHERE id=?`,[row.requirement_id]);
        await tx.execute(`UPDATE evaluation_jobs SET status='staged_pending',attempts=0,last_error=NULL,completed_at=NULL,locked_by=NULL,locked_at=NULL,lease_token=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[row.evaluation_job_id]);
      }
      return rows.length;
    });
  }
}
