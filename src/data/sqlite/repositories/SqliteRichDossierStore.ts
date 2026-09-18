import type { DatabaseAdapter } from '@/data/database';
import { dossierSchema, type Dossier } from '@/dossier/contracts';
import { validateComposition } from '@/dossier/grounding';
import type { DossierPresentationIdentity } from './SqliteDossierPresentationStore';

export const RICH_DOSSIER_VERSION='dossier-v3.6';
export const RICH_DOSSIER_FAILURE_VERSION=`${RICH_DOSSIER_VERSION}-unavailable`;
export class SqliteRichDossierStore {
  constructor(private readonly db:DatabaseAdapter) {}
  async recordFailure(identity:DossierPresentationIdentity,sourceEvaluationFingerprint:string,error:unknown):Promise<void> {
    // Preserve the first failed presentation attempt independently of immutable evaluation data.
    const now=new Date().toISOString();
    await this.db.execute(`INSERT INTO materialized_dossier_presentations(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,presentation_version,source_evaluation_fingerprint,presentation_json,generated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,presentation_version) DO NOTHING`,[identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint,RICH_DOSSIER_FAILURE_VERSION,sourceEvaluationFingerprint,JSON.stringify({state:'UNAVAILABLE',error:error instanceof Error?error.message:String(error),attemptedAt:now}),now]);
  }
  async get(identity:DossierPresentationIdentity,fingerprint:string):Promise<Dossier|null> {
    const row=await this.db.one<{presentation_json:string;source_evaluation_fingerprint:string}>(`SELECT presentation_json,source_evaluation_fingerprint FROM materialized_dossier_presentations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND presentation_version=?`,[identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint,RICH_DOSSIER_VERSION]);
    if(!row)return null;
    try {
      const parsed=dossierSchema.parse(JSON.parse(row.presentation_json));
      if(parsed.sourceEvaluationFingerprint!==row.source_evaluation_fingerprint)return null;
      return row.source_evaluation_fingerprint===fingerprint?parsed:null;
    }catch{return null;}
  }
  async save(identity:DossierPresentationIdentity,sourceEvaluationFingerprint:string,dossier:Dossier):Promise<void> {
    const parsed=dossierSchema.parse(dossier);
    if(parsed.opportunity.id!==identity.canonicalJobId)throw new Error('DOSSIER_OPPORTUNITY_IDENTITY_MISMATCH');
    if(parsed.sourceEvaluationFingerprint&&parsed.sourceEvaluationFingerprint!==sourceEvaluationFingerprint)throw new Error('DOSSIER_EVALUATION_FINGERPRINT_MISMATCH');
    validateComposition(parsed,{claims:[...parsed.evidence.roleClaims,...parsed.evidence.candidateClaims,...parsed.evidence.contextualClaims,...parsed.evidence.relationalClaims],resolutions:parsed.resolutions,candidateConflicts:parsed.candidateConflicts,narrativePlan:parsed.narrativePlan,evaluation:parsed.verdict});
    await this.db.execute(`INSERT INTO materialized_dossier_presentations(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,presentation_version,source_evaluation_fingerprint,presentation_json,generated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,presentation_version) DO NOTHING`,[identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint,RICH_DOSSIER_VERSION,sourceEvaluationFingerprint,JSON.stringify(parsed),parsed.generatedAt]);
  }
}
