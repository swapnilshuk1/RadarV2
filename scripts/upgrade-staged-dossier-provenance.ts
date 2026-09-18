/** Additive, model-free upgrade of validated v3.3 presentations. Old rows are retained. */
import {isDeepStrictEqual} from 'node:util';
import {getDatabaseAdapter} from '../src/data/database';
import {dossierSchema,type JsonValue} from '../src/dossier/contracts';
import {bindStagedEditorial} from '../src/dossier/staged-composition';
import {validateComposition} from '../src/dossier/grounding';
import {sourceFingerprint} from '../src/dossier/pipeline';
import {assertCanonicalDecisionTrace,createStagedEvaluationFingerprint,parseCanonicalStagedDecisionResult} from '../src/dossier/staged-decision-integrity';
import {SqliteRichDossierStore,RICH_DOSSIER_VERSION} from '../src/data/sqlite/repositories/SqliteRichDossierStore';
import {ProductionStagedInputAdapter} from '../src/lib/intelligence/staged/ProductionStagedInputAdapter';
import {StagedServingPublisher} from '../src/lib/intelligence/staged/StagedServingPublisher';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context');if(!context)throw new Error('EXPLICIT_CONTEXT_REQUIRED');
const execute=process.argv.includes('--execute');
const db=getDatabaseAdapter();
// Input reconstruction may only read existing bindings and extraction caches.
const readOnly=new Proxy(db,{get(target,key){if(key==='execute'||key==='transaction')return()=>{throw new Error('UPGRADE_REQUIRES_EXISTING_FROZEN_INPUT');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
const rows=await db.many<{tenant_id:string;person_id:string;canonical_job_id:string;opportunity_version:string;profile_version:string;input_fingerprint:string;model_id:string;model_version:string;evaluation_json:string;presentation_json:string}>(`
 SELECT se.*,p.presentation_json FROM staged_evaluations se JOIN materialized_dossier_presentations p
 ON p.tenant_id=se.tenant_id AND p.person_id=se.person_id AND p.canonical_job_id=se.canonical_job_id AND p.opportunity_version=se.opportunity_version AND p.evaluation_context_fingerprint=se.evaluation_context_fingerprint
 WHERE se.evaluation_context_fingerprint=? AND se.evaluation_state='COMPLETED' AND p.presentation_version='dossier-v3.3' AND p.source_evaluation_fingerprint=se.input_fingerprint
 AND NOT EXISTS(SELECT 1 FROM materialized_dossier_presentations current WHERE current.tenant_id=se.tenant_id AND current.person_id=se.person_id AND current.canonical_job_id=se.canonical_job_id AND current.opportunity_version=se.opportunity_version AND current.evaluation_context_fingerprint=se.evaluation_context_fingerprint AND current.presentation_version=?)
 ORDER BY se.canonical_job_id`,[context,RICH_DOSSIER_VERSION]);
let validated=0;const failures:Array<{job:string;error:string}>=[];
for(const row of rows){
 try{
  const identity={tenantId:row.tenant_id,personId:row.person_id,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:context,profileVersion:row.profile_version};
  const staged=parseCanonicalStagedDecisionResult(JSON.parse(row.evaluation_json));
  const existing=dossierSchema.parse(JSON.parse(row.presentation_json));
  const frozen=await new ProductionStagedInputAdapter(readOnly).build(identity,{id:row.model_id,version:row.model_version,generate:async()=>{throw new Error('UPGRADE_MODEL_CALL_FORBIDDEN');}});
  if(frozen.fingerprint!==row.input_fingerprint)throw new Error('UPGRADE_FROZEN_INPUT_MISMATCH');
  const research=bindStagedEditorial(frozen,staged,{rationale:existing.verdict.rationale,narrativePlan:existing.narrativePlan});
  const existingClaims=[...existing.evidence.roleClaims,...existing.evidence.candidateClaims,...existing.evidence.contextualClaims,...existing.evidence.relationalClaims];
  if(!isDeepStrictEqual(existing.opportunity,frozen.opportunity)||!isDeepStrictEqual(existing.candidate,frozen.candidate)||!isDeepStrictEqual(existing.verdict,research.evaluation)||!isDeepStrictEqual(existing.resolutions,research.resolutions)||!isDeepStrictEqual(existing.candidateConflicts,research.candidateConflicts)||!isDeepStrictEqual(existingClaims,research.claims)||!isDeepStrictEqual(existing.evidence.lineage,frozen.sources)||existing.generation.sourceFingerprint!==sourceFingerprint(frozen.sources))throw new Error('UPGRADE_EXISTING_CONTENT_MISMATCH');
  validateComposition(existing,research);
  const fingerprint=createStagedEvaluationFingerprint({evaluationContextFingerprint:context,inputFingerprint:row.input_fingerprint,evaluation:staged});
  const upgraded={...existing,canonicalDecisionTrace:structuredClone(staged.trace) as unknown as JsonValue,sourceEvaluationFingerprint:fingerprint,sourceInputFingerprint:row.input_fingerprint};
  assertCanonicalDecisionTrace(upgraded,staged.trace);
  if(execute){await new SqliteRichDossierStore(db).save(identity,fingerprint,upgraded);await new StagedServingPublisher(db).publish(identity);}
  validated++;console.log(JSON.stringify({job:row.canonical_job_id,status:execute?'upgraded':'validated'}));
 }catch(error){failures.push({job:row.canonical_job_id,error:error instanceof Error?error.message:String(error)});}
}
console.log(JSON.stringify({selected:rows.length,validated,execute,presentationVersion:RICH_DOSSIER_VERSION,failures}));
if(failures.length)process.exitCode=1;
