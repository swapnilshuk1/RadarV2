/** Resumable staged backfill: selects and enqueues normal durable worker work only. */
import { getDatabaseAdapter } from '../src/data/database';
import { resolveServingScope } from '../src/lib/security/scope-resolver';
import { SqliteEvaluationContextStore } from '../src/data/sqlite/repositories/SqliteEvaluationContextStore';
import { STAGED_POLICY_VERSION } from '../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { EvaluationWorkScheduler } from '../src/lib/intelligence/EvaluationWorkScheduler';
import { computeEvaluationContextFingerprint } from '../src/lib/domain/evaluation_fingerprint';
import { selectUnscheduledStagedCandidates } from '../src/lib/intelligence/staged/backfillSelection';

const args=process.argv.slice(2); const option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined}; const dryRun=args.includes('--dry-run'); const limit=Math.max(1,Number(option('--limit')||'25')); const requestedJob=option('--job-hash'); const requestedPerson=option('--person-id'); const requestedProfileVersion=option('--profile-version');
async function main(){
 const db=getDatabaseAdapter(); const personId=requestedPerson || (await db.one<{person_id:string}>(`SELECT person_id FROM active_evaluation_contexts ORDER BY activated_at DESC LIMIT 1`))?.person_id; if(!personId)throw new Error('BACKFILL_SCOPE_UNAVAILABLE');
 if(!requestedProfileVersion)throw new Error('BACKFILL_PROFILE_VERSION_REQUIRED');
 const scope=(await resolveServingScope(personId)).scope; const contexts=new SqliteEvaluationContextStore(db); const lineage=await contexts.getActiveSearchPlanWithSnapshot(scope); if(!lineage.contextFingerprint)throw new Error('BACKFILL_ACTIVE_CONTEXT_UNAVAILABLE'); const active=await contexts.getEvaluationContext(scope,lineage.contextFingerprint); if(!active)throw new Error('BACKFILL_ACTIVE_CONTEXT_UNAVAILABLE');
 const contextParams={searchPlanSnapshotId:lineage.snapshotId,ontologyVersion:active.ontologyVersion,ontologyFingerprint:active.ontologyFingerprint,policyVersion:STAGED_POLICY_VERSION,profileVersion:requestedProfileVersion};
 const contextFingerprint=computeEvaluationContextFingerprint({tenantId:scope.tenantId,personId:scope.personId,...contextParams});
 const binding=await db.one<{document_id:string}>(`SELECT document_id FROM profile_projection_source_bindings WHERE person_id=? AND profile_version=? LIMIT 1`,[personId,requestedProfileVersion]);
 if(!binding)throw new Error('PROFILE_SOURCE_PROVENANCE_MISSING');
 const staged= dryRun ? {contextFingerprint} : await contexts.createEvaluationContext(scope,contextParams);
 if(!dryRun) await contexts.bindEvaluationContextScope(staged.contextFingerprint,scope.tenantId,personId,lineage.planId);
 const rows=await selectUnscheduledStagedCandidates(db,{tenantId:scope.tenantId,personId,searchPlanId:lineage.planId,contextFingerprint:staged.contextFingerprint,canonicalJobId:requestedJob,limit,readyOnly:args.includes('--ready-only'),excludeSourceVersion:option('--exclude-source-version')});
 const population=await db.one<{candidate_count:number;already_staged:number}>(`SELECT COUNT(*) AS candidate_count, SUM(CASE WHEN se.id IS NOT NULL THEN 1 ELSE 0 END) AS already_staged FROM search_plan_candidates spc JOIN opportunity_versions ov ON ov.canonical_job_id=spc.canonical_job_id AND ov.id=spc.opportunity_version LEFT JOIN staged_evaluations se ON se.tenant_id=spc.tenant_id AND se.person_id=spc.person_id AND se.canonical_job_id=spc.canonical_job_id AND se.opportunity_version=spc.opportunity_version AND se.evaluation_context_fingerprint=? WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE' AND ov.lifecycle_state='ACTIVE' AND ov.acquisition_status='ACQUIRED'`,[staged.contextFingerprint,scope.tenantId,personId,lineage.planId]);
 if(dryRun){console.log(JSON.stringify({dryRun:true,profileVersion:requestedProfileVersion,provenanceDocumentId:binding.document_id,totalEligiblePopulation:population?.candidate_count??0,alreadyStaged:population?.already_staged??0,unseenEligible:Math.max(0,(population?.candidate_count??0)-(population?.already_staged??0)),contextFingerprint:staged.contextFingerprint,previewItems:rows},null,2));return;}
 const scheduler=new EvaluationWorkScheduler(db); const queued=[]; for(const row of rows) queued.push(await scheduler.ensureWork({tenantId:scope.tenantId,personId,searchPlanId:lineage.planId,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:staged.contextFingerprint})); console.log(JSON.stringify({dryRun:false,profileVersion:requestedProfileVersion,selected:queued.length,newJobsQueued:queued.filter(item=>item.queued).length,contextFingerprint:staged.contextFingerprint,outcomes:queued},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'BACKFILL_FAILED');process.exitCode=1});
