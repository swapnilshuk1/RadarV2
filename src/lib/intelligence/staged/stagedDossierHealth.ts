import type {DatabaseAdapter} from '@/data/database';
import {SqliteStagedEvaluationStore} from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import {SqliteRichDossierStore,RICH_DOSSIER_VERSION} from '@/data/sqlite/repositories/SqliteRichDossierStore';
import {assertCanonicalDecisionTrace,createStagedEvaluationFingerprint,parseCanonicalStagedDecisionResult} from '@/dossier/staged-decision-integrity';
import type {ProductionStagedIdentity} from './ProductionStagedInputAdapter';

/** One validation boundary shared by backfill selection and rollout readiness. */
export async function stagedDossierHealth(db:DatabaseAdapter,identity:ProductionStagedIdentity){
  try{
    const record=await new SqliteStagedEvaluationStore(db).get(identity);
    if(!record||record.evaluationState!=='COMPLETED')return {dossier:false,published:false};
    const staged=parseCanonicalStagedDecisionResult(record.evaluation);
    if(staged.decision.verdict!==record.decision||staged.decision.screeningViability!==record.screeningViability)return {dossier:false,published:false};
    if(staged.decision.verdict==='PASS')return {dossier:false,published:false,passSkipped:true};
    const fingerprint=createStagedEvaluationFingerprint({evaluationContextFingerprint:record.evaluationContextFingerprint,inputFingerprint:record.inputFingerprint,evaluation:staged});
    const dossier=await new SqliteRichDossierStore(db).get(identity,fingerprint);
    if(!dossier||dossier.sourceInputFingerprint!==record.inputFingerprint||dossier.verdict.verdict!==record.decision||dossier.verdict.screeningViability!==record.screeningViability)return {dossier:false,published:false};
    assertCanonicalDecisionTrace(dossier,staged.trace);
    const row=await db.one<{evaluation_json:string;evaluation_fingerprint:string;decision:string;evaluation_state:string}>(
      'SELECT evaluation_json,evaluation_fingerprint,decision,evaluation_state FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?',
      [identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint]);
    if(!row)return {dossier:true,published:false};
    let payload;try{payload=JSON.parse(row.evaluation_json);}catch{return {dossier:true,published:false};}
    return {dossier:true,published:row.evaluation_state==='STAGED_EVALUATED'&&row.evaluation_fingerprint===fingerprint&&row.decision===record.decision&&
      payload.schemaVersion==='staged-serving-v1'&&payload.presentationVersion===RICH_DOSSIER_VERSION&&payload.evaluationFingerprint===fingerprint&&payload.inputFingerprint===record.inputFingerprint&&payload.verdict===record.decision&&payload.screeningViability===record.screeningViability};
  }catch{return {dossier:false,published:false};}
}
