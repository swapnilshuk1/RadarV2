import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { claimSchema, sourceSchema, contextFields, scopeFields, type Claim, type ContextProvider, type EvidenceSource, type ReasoningModel } from '@/dossier/contracts';
import { compareCandidateSources, EmptySourceEvidenceError, extractValidatedSourceClaims, selectRelevantContextSources, sourceExtractionFingerprint, sourceFingerprint } from '@/dossier/evidence';
import type { StagedResearchInput } from '@/dossier/staged-role';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import {computeEvaluationContextFingerprint} from '@/evaluation/fingerprint';
import { computeContentHash } from '@/lib/domain/canonical_identity';
import {contextInputFingerprint,SqliteStagedInputStore} from '@/data/sqlite/repositories/SqliteStagedInputStore';
import {ProductionContextProvider} from '@/evaluation/context-provider';
import {ModelProviderUnavailableError} from '@/lib/model/provider-unavailable';
import {STAGED_POLICY_VERSION,supportsStagedPolicy} from '@/evaluation/policy';
import {resolveExactCandidateProjectionForScope} from '@/data/sqlite/repositories/profile-projection-version';
import type { ProductionStagedIdentity } from './contracts';

export class DeterministicStagedInputUnavailableError extends Error { readonly deterministic=true; constructor(readonly reason:string){super(`STAGED_INPUT_UNAVAILABLE:${reason}`);} }
export type { ProductionStagedIdentity } from './contracts';
type CandidateBinding = { document_id:string; evidence_graph_id:string; document_text_hash:string; raw_text:string };

export function normalizeCanonicalJobText(raw:string):string {
  let text=raw;
  try {
    const parsed=JSON.parse(raw);
    text=[parsed.rawDescription,parsed.original?.rawDescription,parsed.description,parsed.content]
      .find((v):v is string=>typeof v==='string'&&v.trim().length>0) ?? raw;
  } catch {}
  text=text
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'\n')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'\n')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,'\n')
    .replace(/<[^>]+>/g,'\n')
    .replace(/(^|\n)[^{\n]{1,200}\{[^{}]{1,4000}\}/g,(block)=>/(?:display|color|font(?:-\w+)?|margin|padding|background|border|width|height)\s*:/i.test(block)?'\n':block)
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>');
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const cleaned:string[]=[];
  for(const line of lines){
    if(/^(?:show more|show less|save job|report job|apply now)$/i.test(line))continue;
    if(cleaned[cleaned.length-1]===line)continue;
    cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}
function extractResearchAliases(text:string,canonical:string):string[]{
  const aliases=new Set<string>();
  const add=(value:string|undefined)=>{
    const cleaned=value?.replace(/\s+/g,' ').replace(/[|:–—-]+$/,'').trim();
    if(!cleaned||cleaned.length<3||cleaned.length>60)return;
    if(cleaned.toLocaleLowerCase()===canonical.toLocaleLowerCase())return;
    if(/^(?:the role|role|job|position|about us|company|overview|who we are)$/i.test(cleaned))return;
    aliases.add(cleaned);
  };
  for(const line of text.split(/\r?\n/).slice(0,120)){
    add(line.match(/^about\s+(.{3,60})$/i)?.[1]);
    add(line.match(/^([A-Z][A-Za-z0-9&.'() ]{2,58})\s+is\s+(?:an?|the)\b/)?.[1]);
    add(line.match(/\bjoin\s+([A-Z][A-Za-z0-9&.'() ]{2,58}?)(?:\s+as\b|\s+to\b|[,.]|$)/)?.[1]);
  }
  return [...aliases].slice(0,3);
}

function extractResearchIdentityTerms(text:string):string[]{
  const terms=new Set<string>();
  const add=(value:string|undefined)=>{
    const cleaned=value?.replace(/\s+/g,' ').replace(/[.;,:]+$/,'').trim();
    if(!cleaned||cleaned.length<5||cleaned.length>90)return;
    terms.add(cleaned);
  };
  const lines=text.split(/\r?\n/).slice(0,140);
  for(const line of lines){
    const isDescriptor=/\b(?:marketplace|agency|platform|software|saas|wellness|beverage|health|fintech|e-?commerce|d2c|tutoring|education|consumer|b2b|b2c)\b/i.test(line);
    if(isDescriptor&&line.length<=120)add(line);
    add(line.match(/\bis\s+(?:an?|the)\s+([^.;]{5,85})/i)?.[1]);
    if(terms.size>=3)break;
  }
  return [...terms].slice(0,3);
}

function contextFieldCoveredByJd(field:string,claims:Claim[]):boolean{
  const explicit=claims.filter(claim=>claim.plane==='JD'&&claim.state==='EXPLICIT');
  const text=explicit.map(claim=>[claim.text,...claim.citations.map(citation=>citation.quote)].join(' ')).join('\n');
  switch(field){
    case 'companySize':
      return /(?:\b\d[\d,]*\s*(?:[-–]\s*\d[\d,]*)?\s+(?:employees?|staff|people)\b|\b(?:headcount|company size|workforce)\b[^.]{0,60}\b\d[\d,]*)/i.test(text);
    case 'funding':
      return /\b(?:raised|funding|funded by|bootstrapped|founder[- ]funded|self[- ]funded|venture[- ]backed|seed round|series [a-z])\b/i.test(text);
    case 'growth':
      // Role/JD growth targets are mandate evidence, not proof of the company's
      // historical trajectory. Keep external growth research enabled so the
      // dossier can distinguish target ambition from demonstrated momentum.
      return false;
    case 'workforceTrajectory':
      // A role mandate to build a team is not evidence of company-wide workforce
      // trajectory. Skip external research only for explicit company headcount movement.
      return /\b(?:company|workforce|headcount|employees?)\b[^.]{0,80}\b(?:grew|growth|increased|decreased|reduced|layoffs?|expanded|contracted)\b/i.test(text)
        || /\b(?:layoffs?|headcount (?:grew|growth|reduction|increase|decrease))\b/i.test(text);
    case 'leadershipChanges':
      return /\b(?:appointed|named|joined|promoted)\b[^.]{0,80}\b(?:CEO|CMO|CFO|COO|CTO|chief|president)\b/i.test(text);
    case 'relatedHiring':
      // Future hiring owned by this role is not the same as evidence of current
      // company-wide hiring activity.
      return /\b(?:company|business|organisation|organization)\b[^.]{0,80}\b(?:is hiring|open roles?|vacancies|hiring across)\b/i.test(text);
    case 'marketExpansion':
      // Planned expansion in a JD is useful mandate evidence but not external
      // confirmation that the company has already entered those markets.
      return false;
    case 'organizationalStructure':
      // Reporting to founders is valuable scope evidence but does not fully
      // describe the company's wider organizational structure.
      return /\b(?:matrix(?:ed)? structure|organizational structure|organisation structure|business units?|divisional structure)\b/i.test(text);
    default:
      return false;
  }
}

function stableSourceId(plane:'JD'|'CANDIDATE', hash:string){return `${plane.toLowerCase()}-${hash.slice(0,24)}`;}
function rebaseClaims(value:unknown[], plane:EvidenceSource['plane'], ordinal:number):Claim[]{return value.map((raw,index)=>{const claim=claimSchema.parse(raw);return {...claim,id:`${plane}-${ordinal}-${index+1}`,plane,derivedFrom:[],citations:claim.citations};});}

export function assertCanonicalJdContentHash(version: { raw_content: string; job_title: string | null; company_name: string | null; location: string | null; employment_type: string | null; content_hash: string | null }) {
  const recomputed = computeContentHash({
    title: version.job_title ?? '', companyName: version.company_name, location: version.location,
    employmentType: version.employment_type, rawContent: version.raw_content,
  });
  if (!version.content_hash || recomputed !== version.content_hash) {
    throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_HASH_MISMATCH');
  }
}

export class ProductionStagedInputAdapter {
  constructor(private readonly db:DatabaseAdapter, private readonly cache=new SqliteStagedEvaluationStore(db),private readonly providers?:ContextProvider[]) {}

  async build(identity:ProductionStagedIdentity, model:ReasoningModel, onStage:(stage:string)=>void=()=>{}):Promise<StagedResearchInput>{
    const context=await this.db.one<{policy_version:string;profile_version:string;search_plan_snapshot_id:string;ontology_version:string;ontology_fingerprint:string}>(`SELECT policy_version,profile_version,search_plan_snapshot_id,ontology_version,ontology_fingerprint FROM evaluation_contexts WHERE context_fingerprint=? AND tenant_id=? AND person_id=?`,[identity.evaluationContextFingerprint,identity.tenantId,identity.personId]);
    if(!context||!supportsStagedPolicy(context.policy_version)||context.profile_version!==identity.profileVersion)throw new DeterministicStagedInputUnavailableError('EVALUATION_CONTEXT_PROFILE_MISMATCH');
    const version=await this.db.one<any>(`SELECT raw_content,job_title,company_name,location,employment_type,content_hash FROM opportunity_versions WHERE canonical_job_id=? AND id=?`,[identity.canonicalJobId,identity.opportunityVersion]);
    if(!version) throw new DeterministicStagedInputUnavailableError('OPPORTUNITY_VERSION_MISSING');
    assertCanonicalJdContentHash(version);
    const jdText=normalizeCanonicalJobText(version.raw_content||''); if(!jdText) throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_MISSING');
    const bindings=await this.db.many<CandidateBinding>(`SELECT b.document_id,b.evidence_graph_id,b.document_text_hash,dc.raw_text FROM profile_projection_source_bindings b JOIN document_contents dc ON dc.document_id=b.document_id AND dc.tenant_id=b.tenant_id AND dc.person_id=b.person_id JOIN evidence_graphs eg ON eg.id=b.evidence_graph_id AND eg.document_id=b.document_id AND eg.tenant_id=b.tenant_id AND eg.person_id=b.person_id WHERE b.tenant_id=? AND b.person_id=? AND b.profile_version=? ORDER BY b.document_id`,[identity.tenantId,identity.personId,identity.profileVersion]);
    if(!bindings.length) throw new DeterministicStagedInputUnavailableError('PROFILE_SOURCE_PROVENANCE_MISSING');
    const jdSource:EvidenceSource={id:stableSourceId('JD',version.content_hash||createHash('sha256').update(jdText).digest('hex')),plane:'JD',title:version.job_title||'Opportunity description',locator:`opportunity-version:${identity.canonicalJobId}:${identity.opportunityVersion}`,text:jdText,capturedAt:new Date(0).toISOString(),attribution:'JOB_POST'};
    const candidateSources:EvidenceSource[]=bindings.map((row)=>({id:stableSourceId('CANDIDATE',createHash('sha256').update(`${row.document_id}:${row.document_text_hash}`).digest('hex')),plane:'CANDIDATE',title:`Candidate document ${row.document_id}`,locator:`candidate-document:${row.document_id}:evidence:${row.evidence_graph_id}`,text:row.raw_text, capturedAt:new Date(0).toISOString(),attribution:'CANDIDATE_SUPPLIED'}));
    return this.buildContextInput(identity,model,jdSource,candidateSources,onStage,context.policy_version,computeEvaluationContextFingerprint({tenantId:identity.tenantId,personId:identity.personId,searchPlanSnapshotId:context.search_plan_snapshot_id,ontologyVersion:context.ontology_version,ontologyFingerprint:context.ontology_fingerprint,policyVersion:context.policy_version,profileVersion:context.profile_version}));
  }
  private async buildContextInput(
    identity:ProductionStagedIdentity,
    model:ReasoningModel,
    jd:EvidenceSource,
    candidates:EvidenceSource[],
    onStage:(stage:string)=>void,
    policyVersion:string,
    expectedContextFingerprint:string,
  ):Promise<StagedResearchInput>{
    const [projection,contextRow]=await Promise.all([
      resolveExactCandidateProjectionForScope(
        this.db,
        {tenantId:identity.tenantId,personId:identity.personId},
        identity.profileVersion,
      ),
      this.db.one<{payload_json:string}>(
        `SELECT sps.payload_json
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps
           ON sps.id=ec.search_plan_snapshot_id
          AND sps.tenant_id=ec.tenant_id
          AND sps.person_id=ec.person_id
         WHERE ec.context_fingerprint=? AND ec.tenant_id=? AND ec.person_id=?`,
        [identity.evaluationContextFingerprint,identity.tenantId,identity.personId],
      ),
    ]);
    if(!projection)throw new DeterministicStagedInputUnavailableError('PROFILE_PROJECTION_VERSION_MISSING');
    let intent:any=null;
    if(contextRow?.payload_json){
      try{
        const payload=JSON.parse(contextRow.payload_json);
        intent=payload?.customParameters?.candidateDecisionIntent??null;
      }catch{}
    }
    const candidateDecisionProfile={
      projection:{
        currentTitle:projection.attainedTitle,
        yearsExperience:projection.yearsOfExperience,
        archetype:projection.archetype,
        operatingLevel:projection.operatingLevel,
        candidateSeniorityLevel:projection.candidateSeniorityLevel,
        workNature:projection.workNature,
        decisionAuthority:projection.decisionAuthority,
        commercialScope:projection.commercialScope,
        coreCapabilities:projection.coreCapabilities,
        demonstratedCapabilities:projection.demonstratedCapabilities,
        executiveThemes:projection.executiveThemes,
      },
      intent,
    };
    const binding=createHash('sha256').update(JSON.stringify({profile:identity.profileVersion,sources:sourceFingerprint([jd,...candidates]),candidateDecisionProfile})).digest('hex');
    const store=new SqliteStagedInputStore(this.db);
    const existing=await store.get(identity,binding,model);if(existing)return existing;
    if(policyVersion!==STAGED_POLICY_VERSION)throw new ModelProviderUnavailableError('FRESH_CONTEXT_INPUT_REQUIRES_STAGED_V8');
    if(identity.evaluationContextFingerprint!==expectedContextFingerprint)throw new ModelProviderUnavailableError('CONTEXT_ACQUISITION_POLICY_IDENTITY_MISMATCH');
    if(await this.cache.get(identity))throw new Error('STAGED_COMPLETED_INPUT_SNAPSHOT_MISSING');

    const version=await this.db.one<{company_name:string|null;job_title:string|null;location:string|null}>(`SELECT company_name,job_title,location FROM opportunity_versions WHERE id=? AND canonical_job_id=?`,[identity.opportunityVersion,identity.canonicalJobId]);
    const person=await this.db.one<{email:string}>(`SELECT email FROM people WHERE id=? AND tenant_id=?`,[identity.personId,identity.tenantId]);
    const opportunity={id:identity.canonicalJobId,company:version?.company_name||'Unknown company',title:version?.job_title||'Unknown role'};
    const researchOpportunity={
      ...opportunity,
      researchAliases:extractResearchAliases(jd.text,opportunity.company),
      researchIdentityTerms:extractResearchIdentityTerms(jd.text),
      researchLocation:version?.location??undefined,
    };
    const providers=this.providers??[new ProductionContextProvider(this.db,identity.tenantId)];
    if(!providers.length)throw new Error('STAGED_CONTEXT_PROVIDER_REQUIRED');

    const loadClaims=async(source:EvidenceSource,ordinal:number)=>{
      const key={
        sourceFingerprint:sourceExtractionFingerprint(source),
        modelId:model.id,
        modelVersion:model.version,
        modelConfigurationFingerprint:model.configurationFingerprint??"unconfigured",
      };
      let claims=await this.cache.cachedClaims(identity,key);
      if(!claims){
        onStage(`Extracting immutable ${source.plane} source evidence`);
        try{
          claims=await extractValidatedSourceClaims(model,source,`${source.plane}-1-`,onStage);
        }catch(error){
          if(source.plane!=='CONTEXT'||!(error instanceof EmptySourceEvidenceError))throw error;
          claims=[];
        }
        await this.cache.cacheClaims(identity,key,source,claims);
      }
      return rebaseClaims(claims,source.plane,ordinal);
    };

    onStage('Extracting role and candidate evidence before external research');
    const baseEvidence=(await Promise.all([
      loadClaims(jd,1),
      ...candidates.map((source,index)=>loadClaims(source,index+1)),
    ])).flat();

    const jdClaims=baseEvidence.filter(claim=>claim.plane==='JD');
    const coveredContextFields=contextFields.filter(field=>contextFieldCoveredByJd(field,jdClaims));
    const missingContextFields=contextFields.filter(field=>!coveredContextFields.includes(field));
    const jdCoverageAttempts=coveredContextFields.map(field=>({
      provider:'job-description',
      field,
      operation:'retrieve' as const,
      status:'ACQUIRED' as const,
      sourceIds:[jd.id],
      detail:'Explicit JD evidence already covers this context field; external lookup was skipped.',
    }));

    let acquired:Awaited<ReturnType<ContextProvider['acquire']>>[]=[];
    if(missingContextFields.length){
      onStage(`Researching ${missingContextFields.length} unresolved company-context fields`);
      acquired=await Promise.all(
        providers.map(provider=>provider.acquire(researchOpportunity,missingContextFields)),
      );
      if(!acquired.some(result=>result.attempts.some(attempt=>['RETRIEVED','NO_RESULTS','ACQUIRED'].includes(attempt.status)))){
        throw new ModelProviderUnavailableError('CONTEXT_ACQUISITION_NOT_OPERATIONAL');
      }
    }
    const contextSources=acquired.flatMap(result=>result.sources).map(source=>sourceSchema.parse(source));
    if(contextSources.some(source=>source.plane!=='CONTEXT'))throw new Error('CONTEXT_PROVIDER_SOURCE_PLANE_INVALID');
    const uniqueContext=[...new Map(contextSources.map(source=>[source.id,source])).values()];
    const acquisition=[...jdCoverageAttempts,...acquired.flatMap(result=>result.attempts)];

    const [selected,candidateConflicts]=await Promise.all([
      selectRelevantContextSources(researchOpportunity,jd,uniqueContext,model,onStage,missingContextFields),
      compareCandidateSources([jd,...candidates],baseEvidence,model,onStage),
    ]);
    for(const attempt of acquisition)attempt.detail+=` Relevance selection: ${selected.reasoning}`;

    const selectedSet=new Set(selected.sourceIds);
    const selectedContext=uniqueContext.filter(source=>selectedSet.has(source.id));
    const contextEvidence=(await Promise.all(
      selectedContext.map((source,index)=>loadClaims(source,index+1)),
    )).flat();
    const sources=[jd,...candidates,...uniqueContext];
    const evidence=[...baseEvidence,...contextEvidence];

    const base={
      opportunity,
      candidate:{name:person?.email||'Candidate'},
      candidateDecisionProfile,
      sources,
      evidence,
      candidateSourceRefs:candidates.map(source=>({id:source.id,title:source.title})),
      candidateConflicts,
      acquisition,
      validEvidenceClaimIds:evidence.map(claim=>claim.id),
      fields:[...contextFields,...scopeFields],
    };
    return store.save(identity,binding,model,{...base,fingerprint:contextInputFingerprint(base)});
  }

}
