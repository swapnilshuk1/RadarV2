import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { claimSchema, contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '@/dossier/contracts';
import { extractValidatedSourceClaims, sourceFingerprint } from '@/dossier/pipeline';
import type { StagedResearchInput } from '@/dossier/staged-research';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { versionCandidateProjection } from '@/data/sqlite/repositories/profile-projection-version';
import { EvidenceNormalizer } from '@/lib/intelligence/extraction/EvidenceNormalizer';
import { OntologyResolver } from '@/lib/intelligence/extraction/OntologyResolver';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { OperatingLevelEngine } from '@/lib/intelligence/engines/OperatingLevelEngine';
import type { EvidenceGraph } from '@/domain/evidence';

export class DeterministicStagedInputUnavailableError extends Error { readonly deterministic=true; constructor(readonly reason:string){super(`STAGED_INPUT_UNAVAILABLE:${reason}`);} }
export interface ProductionStagedIdentity { tenantId:string; personId:string; canonicalJobId:string; opportunityVersion:string; evaluationContextFingerprint:string; profileVersion:string; }
type CandidateBinding = { document_id:string; evidence_graph_id:string; document_text_hash:string; raw_text:string };

function rawJobText(raw:string):string { try { const parsed=JSON.parse(raw); const candidate=[parsed.rawDescription,parsed.original?.rawDescription,parsed.description,parsed.content].find((v):v is string=>typeof v==='string'&&v.trim().length>0); return candidate?.trim()||raw; } catch { return raw.trim(); } }
function stableSourceId(plane:'JD'|'CANDIDATE', hash:string){return `${plane.toLowerCase()}-${hash.slice(0,24)}`;}
function rebaseClaims(value:unknown[], plane:'JD'|'CANDIDATE', ordinal:number):Claim[]{return value.map((raw,index)=>{const claim=claimSchema.parse(raw);return {...claim,id:`${plane}-${ordinal}-${index+1}`,plane,derivedFrom:[],citations:claim.citations};});}

export class ProductionStagedInputAdapter {
  constructor(private readonly db:DatabaseAdapter, private readonly cache=new SqliteStagedEvaluationStore(db)) {}

  /**
   * An old projection can be used only when one stored candidate document
   * deterministically reconstructs its exact immutable profile version. This is
   * recovery of source lineage, never a latest-document fallback.
   */
  private async recoverExactCandidateBinding(identity:ProductionStagedIdentity):Promise<CandidateBinding[]> {
    const candidates=await this.db.many<CandidateBinding & { graph_json:string }>(
      `SELECT dc.document_id, eg.id AS evidence_graph_id, dc.text_hash AS document_text_hash, dc.raw_text, eg.graph_json
       FROM document_contents dc
       JOIN candidate_documents cd ON cd.id=dc.document_id
       JOIN evidence_graphs eg ON eg.document_id=dc.document_id
       WHERE cd.person_id=?
       ORDER BY dc.document_id, eg.created_at`,
      [identity.personId],
    );
    const builder=new CandidateProjectionBuilderImpl();
    const matches:CandidateBinding[]=[];
    for(const candidate of candidates) {
      try {
        const graph=JSON.parse(candidate.graph_json) as EvidenceGraph;
        const normalized=EvidenceNormalizer.normalize(graph);
        const base=builder.fromEvidence(normalized, OntologyResolver.resolve(normalized));
        const reconstructed=versionCandidateProjection(OperatingLevelEngine.evaluate(base,candidate.raw_text));
        if(reconstructed.profileVersion===identity.profileVersion) {
          matches.push({ document_id:candidate.document_id,evidence_graph_id:candidate.evidence_graph_id,document_text_hash:candidate.document_text_hash,raw_text:candidate.raw_text });
        }
      } catch {
        // A malformed historical graph proves nothing and cannot be a source binding.
      }
    }
    if(matches.length!==1) return [];
    const match=matches[0];
    await this.db.execute(
      `INSERT INTO profile_projection_source_bindings (person_id, profile_version, document_id, evidence_graph_id, document_text_hash)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id, profile_version, document_id) DO NOTHING`,
      [identity.personId,identity.profileVersion,match.document_id,match.evidence_graph_id,match.document_text_hash],
    );
    return [match];
  }

  async build(identity:ProductionStagedIdentity, model:ReasoningModel, onStage:(stage:string)=>void=()=>{}):Promise<StagedResearchInput>{
    const version=await this.db.one<any>(`SELECT raw_content,job_title,company_name,content_hash FROM opportunity_versions WHERE canonical_job_id=? AND id=?`,[identity.canonicalJobId,identity.opportunityVersion]);
    if(!version) throw new DeterministicStagedInputUnavailableError('OPPORTUNITY_VERSION_MISSING');
    const jdText=rawJobText(version.raw_content||''); if(!jdText) throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_MISSING');
    let bindings=await this.db.many<CandidateBinding>(`SELECT b.document_id,b.evidence_graph_id,b.document_text_hash,dc.raw_text FROM profile_projection_source_bindings b JOIN document_contents dc ON dc.document_id=b.document_id JOIN evidence_graphs eg ON eg.id=b.evidence_graph_id AND eg.document_id=b.document_id WHERE b.person_id=? AND b.profile_version=? ORDER BY b.document_id`,[identity.personId,identity.profileVersion]);
    if(!bindings.length) bindings=await this.recoverExactCandidateBinding(identity);
    if(!bindings.length) throw new DeterministicStagedInputUnavailableError('PROFILE_SOURCE_PROVENANCE_MISSING');
    const jdSource:EvidenceSource={id:stableSourceId('JD',version.content_hash||createHash('sha256').update(jdText).digest('hex')),plane:'JD',title:version.job_title||'Opportunity description',locator:`opportunity-version:${identity.canonicalJobId}:${identity.opportunityVersion}`,text:jdText,capturedAt:new Date(0).toISOString(),attribution:'JOB_POST'};
    const candidateSources:EvidenceSource[]=bindings.map((row)=>({id:stableSourceId('CANDIDATE',row.document_text_hash),plane:'CANDIDATE',title:`Candidate document ${row.document_id}`,locator:`candidate-document:${row.document_id}:evidence:${row.evidence_graph_id}`,text:row.raw_text, capturedAt:new Date(0).toISOString(),attribution:'CANDIDATE_SUPPLIED'}));
    const sources=[jdSource,...candidateSources]; const evidence:Claim[]=[];
    for(const source of sources) { const ordinal=source.plane==='JD'?1:candidateSources.findIndex(item=>item.id===source.id)+1; const key={sourceFingerprint:sourceFingerprint([source]),modelId:model.id,modelVersion:model.version}; let cached=await this.cache.cachedClaims(key); if(!cached){onStage(`Extracting immutable ${source.plane} source evidence`); cached=await extractValidatedSourceClaims(model,source,`${source.plane}-1-`,onStage); await this.cache.cacheClaims(key,source,cached);} evidence.push(...rebaseClaims(cached,source.plane,ordinal)); }
    const candidate=await this.db.one<{email:string}>(`SELECT email FROM people WHERE id=? AND tenant_id=?`,[identity.personId,identity.tenantId]);
    const frozenBase={opportunity:{id:identity.canonicalJobId,company:version.company_name||'Unknown company',title:version.job_title||'Unknown role'},candidate:{name:candidate?.email||'Candidate'},sources,evidence,candidateSourceRefs:candidateSources.map(source=>({id:source.id,title:source.title})),candidateConflicts:[],acquisition:[],validEvidenceClaimIds:evidence.map(claim=>claim.id),fields:[...contextFields,...scopeFields]};
    const fingerprint=createHash('sha256').update(JSON.stringify({opportunity:frozenBase.opportunity,candidate:frozenBase.candidate,candidateSources:frozenBase.candidateSourceRefs,candidateConflicts:[],evidence,validEvidenceClaimIds:frozenBase.validEvidenceClaimIds,acquisition:[],fields:frozenBase.fields})).digest('hex');
    return {...frozenBase,fingerprint} as StagedResearchInput;
  }
}
