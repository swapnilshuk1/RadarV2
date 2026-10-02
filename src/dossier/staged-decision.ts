import type { StageObserver } from "../lib/model/stage-observer";
import { createHash } from 'node:crypto';
import { ModelProviderUnavailableError } from '../lib/model/provider-unavailable';
import { z } from 'zod';

import { type Claim, type ReasoningModel } from './contracts';
import { bedrockJsonSchema } from './bedrock-schema';
import { modelSchema } from './model-schema';
import {
  eligibleScreeningDrivers,
  materializeStagedRoleAnalysis,
  stagedMappingResponseSchema,
  stagedRoleAnalysisSchema,
  type StagedMappedRequirement,
  type StagedResearchInput,
  type StagedRoleRequirement,
} from './staged-role';
import {
  screeningConstraintForDrivers,
  materializeStagedDecisionResolutions,
  stagedCareerCapitalSchema,
  stagedDecisionProposalSchema,
  stagedDecisionResolutionResponseSchema,
  stagedGapResponseSchema,
  validateStagedDecisionModel,
  validateStagedCareerCapital,
  validateStagedGap,
  type StagedDecisionResult,
  type StagedScreeningDriver,
} from './staged-decision-contract';
import {
  materializeStagedScreeningAdjudication,
  stagedDecisionScreeningInstruction,
  stagedScreeningAdjudicationSchema,
  type StagedScreeningQuote,
} from './staged-screening';
import {
  stagedDecisionGapInstruction,
  stagedDecisionCareerCapitalInstruction,
  contextAwareDecisionInstruction,
  stagedDecisionMappingInstruction,
  stagedDecisionResolutionInstruction,
  stagedDecisionRoleInstruction,
} from './staged-decision-prompts';

const verifiedStageResults = new Map<string, unknown>();

function schemaForModel(model: ReasoningModel, schema: z.ZodTypeAny): Record<string, unknown> {
  return /bedrock/i.test(model.id) ? bedrockJsonSchema(schema) : modelSchema(schema);
}

function stageKey(model: ReasoningModel, instruction: string, input: unknown, schema: z.ZodTypeAny): string {
  return createHash('sha256')
    .update(JSON.stringify([
      model.id,
      model.version,
      model.configurationFingerprint ?? "unconfigured",
      instruction,
      input,
      schemaForModel(model, schema),
    ], (key, value) => key === 'capturedAt' ? undefined : value))
    .digest('hex');
}

async function proposeStage<T>(
  label: string,
  model: ReasoningModel,
  instruction: string,
  input: unknown,
  schema: z.ZodTypeAny,
  validate: (value: unknown) => T,
  onStage: StageObserver,
  callStage = label,
): Promise<T> {
  const key = stageKey(model, instruction, input, schema);
  if (verifiedStageResults.has(key)) {
    return validate(structuredClone(verifiedStageResults.get(key)));
  }

  let previous: unknown;
  let issue = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    onStage(attempt ? `${label} — local repair ${attempt}` : label, attempt ? { kind: "repair", stage: label } : undefined);
    try {
      previous = await model.generate(
        instruction,
        attempt
          ? {
              input,
              previous,
              repair: `Repair only this stage result. Defect: ${issue}. Preserve all immutable upstream judgments and use only supplied identifiers.`,
            }
          : input,
        schemaForModel(model, schema),
        { stage: callStage, attempt: attempt + 1 },
      );
      const result = validate(previous);
      if (verifiedStageResults.size >= 256) {
        verifiedStageResults.delete(verifiedStageResults.keys().next().value!);
      }
      verifiedStageResults.set(key, structuredClone(previous));
      return result;
    } catch (error) {
      if (error instanceof ModelProviderUnavailableError) throw error;
      await model.discardResponse?.(previous);
      issue = error instanceof Error ? error.message : 'Invalid stage response';
    }
  }
  throw new Error(`${label} failed after local repair: ${issue}`);
}

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} reference`);
  const unknown = ids.find(id => !known.has(id));
  if (unknown) throw new Error(`Unknown ${label} reference: ${unknown}`);
}


function buildScreeningQuoteCatalog(
  requirement: StagedRoleRequirement,
  roleClaimById: ReadonlyMap<string, Claim>,
  jdSourceIds: ReadonlySet<string>,
): StagedScreeningQuote[] {
  return requirement.roleClaimIds.flatMap(claimId => {
    const claim = roleClaimById.get(claimId);
    if (!claim) throw new Error(`Unknown role claim reference: ${claimId}`);
    return claim.citations.flatMap((citation, citationIndex) =>
      jdSourceIds.has(citation.sourceId)
        ? [{ id: `${claimId}:Q${citationIndex + 1}`, text: citation.quote }]
        : []
    );
  });
}

function validateMapping(value: unknown, candidateClaims: Claim[]) {
  const parsed = stagedMappingResponseSchema.parse(value);
  const known = new Set(candidateClaims.map(claim => claim.id));
  exactIds(parsed.candidateClaimIds, known, 'candidate mapping claim');
  if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(parsed.status) && !parsed.candidateClaimIds.length) {
    throw new Error('Positive fit mapping needs candidate proof');
  }
  if (parsed.status === 'CONTRADICTED' && !parsed.candidateClaimIds.length) {
    throw new Error('Contradicted fit mapping needs affirmative candidate evidence');
  }
  if (parsed.status === 'DIRECT' && parsed.unsupportedAspects.length) {
    throw new Error('Direct fit mapping cannot contain unsupported requirement aspects');
  }
  return parsed;
}

const screeningBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    adjudication: stagedScreeningAdjudicationSchema,
  }).strict()),
}).strict();

const mappingBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    mapping: stagedMappingResponseSchema,
  }).strict()),
}).strict();

const gapBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    gap: stagedGapResponseSchema,
  }).strict()),
}).strict();

export const STAGED_DECISION_BATCH_SIZE = 10;

export function chunkStagedDecisionItems<T>(
  items: readonly T[],
  size = STAGED_DECISION_BATCH_SIZE,
): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function exactBatch<T extends { requirementId: string }>(
  rows: T[],
  ids: string[],
  label: string,
): Map<string, T> {
  const expected = new Set(ids);
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!expected.has(row.requirementId) || result.has(row.requirementId)) {
      throw new Error(`Invalid or duplicate ${label} requirement: ${row.requirementId}`);
    }
    result.set(row.requirementId, row);
  }
  if (result.size !== expected.size) {
    const missing = ids.filter(id => !result.has(id));
    throw new Error(`Missing ${label} requirements: ${missing.join(', ')}`);
  }
  return result;
}

export function normalizeUnsupportedResolutionDrafts(
  drafts: z.infer<typeof stagedDecisionResolutionResponseSchema>["resolutions"],
) {
  return drafts.map(draft =>
    draft.status !== 'OPEN' && (draft.value === null || draft.claimIds.length === 0)
      ? {
          ...draft,
          status: 'OPEN' as const,
          value: null,
          claimIds: [],
          question: draft.question ?? `What evidence establishes ${draft.field}?`,
        }
      : draft,
  );
}

function hasGeographicOrCustomerMarketExpansion(text:string):boolean {
  return /\b(?:expand|expansion|enter(?:ing|ed)?|launch(?:ed|ing)?|scale|scaling)\w*\b[^.]{0,120}\b(?:international(?:ly)?|national(?:ly)?|global(?:ly)?|new\s+(?:geograph(?:y|ies)|markets?)|customer\s+markets?|outside\s+india|beyond\s+india|operations?\s+in)\b|\b(?:international|national|global)\s+markets?\b|\b(?:customer\s+market|geographic|geographical)\s+expansion\b/i.test(text);
}


function escapeRegex(value:string):string {
  return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

function unsupportedCanonicalAlias(
  text:string,
  frozen:StagedResearchInput,
):{full:string;alias:string}|null {
  const canonical=frozen.opportunity.company.trim();
  if(!canonical)return null;
  const pattern=new RegExp(`\\b${escapeRegex(canonical)}\\s*\\(([^)\\n]{2,80})\\)`,'i');
  const match=text.match(pattern);
  if(!match)return null;
  const alias=match[1]!.trim();
  if(alias.toLocaleLowerCase()===canonical.toLocaleLowerCase())return null;
  const canonicalLower=canonical.toLocaleLowerCase();
  const aliasLower=alias.toLocaleLowerCase();
  const linked=frozen.evidence.some(claim=>{
    if(claim.state!=='EXPLICIT'||!['JD','CONTEXT','RELATIONAL'].includes(claim.plane))return false;
    const sourceText=[claim.text,...claim.citations.map(citation=>citation.quote)].join(' ').toLocaleLowerCase();
    if(!sourceText.includes(canonicalLower)||!sourceText.includes(aliasLower))return false;
    const exactPair =
      sourceText.includes(`${canonicalLower} (${aliasLower})`) ||
      sourceText.includes(`${aliasLower} (${canonicalLower})`);
    const relational=/\b(?:aka|also known as|formerly|trading as|doing business as|dba|brand of|operated by|owned by|part of|subsidiary|parent company|legal entity)\b/i.test(sourceText);
    return exactPair||relational;
  });
  return linked?null:{full:match[0],alias};
}

function hasCompanyWorkforceMovement(text:string):boolean {
  return /\b(?:headcount|workforce|employee\s+count|employees?|staff(?:ing)?)\b[^.]{0,100}\b(?:grew|grown|growth|increase(?:d|s|ing)?|decrease(?:d|s|ing)?|reduc(?:e|ed|tion)|expand(?:ed|s|ing)?|contract(?:ed|s|ing)?|declin(?:e|ed|ing)|layoffs?)\b|\b(?:company-wide\s+hiring|hiring\s+across\s+(?:multiple\s+)?(?:teams|departments|functions)|layoffs?|workforce\s+(?:expansion|reduction)|headcount\s+(?:expansion|reduction))\b/i.test(text);
}

function claimEstablishesCompanyWorkforceMovement(claim:Claim):boolean {
  if(claim.state!=='EXPLICIT')return false;
  return [claim.text,...claim.citations.map(citation=>citation.quote)]
    .some(hasCompanyWorkforceMovement);
}

function hasRelatedHiringEvidence(text:string):boolean {
  return /\b(?:also\s+hiring|hiring\s+(?:for|across)|recruiting\s+(?:for|across)|open\s+(?:roles|positions)|vacancies|other\s+(?:roles|positions)|multiple\s+(?:roles|positions)|job\s+openings?)\b/i.test(text);
}

function hasExplicitOrganizationalStructure(text:string):boolean {
  return /\b(?:organizational|organisation|org)\s+structure\b|\b(?:matrix(?:ed)?|functional|divisional|flat|centralized|decentralized|hierarchical)\s+(?:organization|organisation|structure|team)\b|\bbusiness units?\b|\bsubsidiar(?:y|ies)\b/i.test(text);
}

function claimEstablishesRolePeopleScale(claim:Claim):boolean {
  if(claim.plane!=='JD'||claim.state!=='EXPLICIT')return false;
  return [claim.text,...claim.citations.map(citation=>citation.quote)].some(support=>
    /\b(?:individual contributor|no direct reports?|without direct reports?|does not manage (?:a )?team)\b/i.test(support)
      || /\b(?:team|direct reports?|reports?)\b[^.]{0,50}\b\d+\b|\b\d+\s+(?:direct reports?|people|team members?)\b/i.test(support)
  );
}

function normalizeSemanticallyUnsupportedContextResolutions(
  drafts:ReturnType<typeof normalizeUnsupportedResolutionDrafts>,
  frozen:StagedResearchInput,
) {
  const claims=new Map(frozen.evidence.map(claim=>[claim.id,claim]));
  return drafts.map(draft=>{
    if(draft.status==='OPEN')return draft;
    const resolutionClaims=draft.claimIds.map(id=>claims.get(id)).filter((claim):claim is Claim=>Boolean(claim));
    const support=resolutionClaims.flatMap(claim=>[
      claim.text,
      ...claim.citations.map(citation=>citation.quote),
    ]).join(' ');
    let question:string|undefined;
    if(draft.field==='organizationalStructure'&&!hasExplicitOrganizationalStructure(support)){
      question="What is the company's actual organizational structure, leadership topology, and operating model?";
    }else if(
      draft.field==='workforceTrajectory' &&
      !resolutionClaims.some(claimEstablishesCompanyWorkforceMovement)
    ){
      question='What company-wide headcount growth, contraction, layoffs, or hiring expansion has occurred?';
    }else if(draft.field==='relatedHiring'&&!hasRelatedHiringEvidence(support)){
      question='What other roles or positions is the company currently hiring for?';
    }else if(draft.field==='teamScale'&&!resolutionClaims.some(claimEstablishesRolePeopleScale)){
      question='What direct-report or people-management scale does this role actually own?';
    }else{
      return draft;
    }
    return {
      ...draft,
      status:'OPEN' as const,
      value:null,
      claimIds:[],
      question:draft.question ?? question,
    };
  });
}

function normalizeUnverifiedCompanyAliasQuestions(
  drafts:ReturnType<typeof normalizeUnsupportedResolutionDrafts>,
  frozen:StagedResearchInput,
) {
  return drafts.map(draft=>{
    if(draft.status!=='OPEN'||!draft.question)return draft;
    const unsupported=unsupportedCanonicalAlias(draft.question,frozen);
    if(!unsupported)return draft;
    return {
      ...draft,
      question:draft.question.replace(unsupported.full,'the opportunity business'),
    };
  });
}

function claimDirectlyCoversField(field:string,claim:Claim):boolean {
  if(claim.state!=='EXPLICIT')return false;
  const text=[claim.text,...claim.citations.map(citation=>citation.quote)].join(' ');
  switch(field){
    case 'companySize':
      return claim.plane==='CONTEXT' && /\b(?:headcount|employees?|staff|workforce)\b[^.]{0,80}\b\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?/i.test(text);
    case 'reportingLine':
      return claim.plane==='JD' && /\breports?\s+(?:directly\s+)?to\b/i.test(text);
    case 'growth':
      return /\b(?:growth|grow|increase|scale(?:d|s|ing)?|grew)\b/i.test(text)
        && /(?:\b\d+(?:\.\d+)?\s*[x×%]\b|\bfrom\s+[^.]{0,40}\bto\s+\d)/i.test(text);
    case 'funding':
      return /\b(?:funding|funded|raised|bootstrapped|founder[- ]funded|capital)\b/i.test(text);
    case 'compensation':
      return claim.plane==='JD' && /\b(?:salary|compensation|equity|stock|bonus|pay|ctc|no\s+salary)\b/i.test(text);
    case 'marketExpansion':
      return claim.plane==='JD' && hasGeographicOrCustomerMarketExpansion(text);
    default:
      return false;
  }
}

function explicitRoleEvidenceSupportsField(field:string,evidence:Claim[]):string[]{
  const explicit=evidence.filter(claim=>claim.plane==='JD'&&claim.state==='EXPLICIT');
  const text=explicit.map(claim=>claim.text).join('\n');
  let supported=false;
  switch(field){
    case 'leadershipMode':
      supported=/\b(?:hands[- ]on|execute|run campaigns?|do the work)\b/i.test(text)
        && /\b(?:build|lead|manage|hire)\w*\b[^.]{0,80}\bteam\b/i.test(text);
      break;
    case 'functionState':
      supported=/\b(?:build\w*\s+(?:it|the\s+function|marketing|growth)?\s*from\s+(?:the\s+)?ground\s+up|zero[- ]to[- ]one|does(?:n't| not)\s+exist\s+yet|set\s+up\s+[^.]{0,80}(?:function|infrastructure|analytics|reporting))\b/i.test(text);
      break;
    case 'commercialScope':
      supported=/\b(?:P&L|profit\s*(?:and|&)\s*loss|budget(?:ing)?|revenue ownership|commercial strategy|own\w*\s+(?:acquisition|activation|retention|growth|full funnel|channel allocation))\b/i.test(text);
      break;
    case 'organizationalStructure':
      // Founder reporting establishes reportingLine, not the wider org design.
      // Treat structure as answered only when the JD actually describes the
      // organizational model or units.
      supported=/\b(?:organizational|organisation|org)\s+structure\b|\b(?:matrix(?:ed)?|functional|divisional|flat|centralized|decentralized)\s+(?:organization|organisation|structure)\b|\bbusiness units?\b|\bsubsidiar(?:y|ies)\b/i.test(text);
      break;
    case 'teamScale':
      supported=/\b(?:individual contributor|no direct reports?|without direct reports?|does not manage (?:a )?team)\b/i.test(text)
        || /\b(?:team|direct reports?|reports?)\b[^.]{0,50}\b\d+\b|\b\d+\s+(?:direct reports?|people|team members?)\b/i.test(text);
      break;
  }
  return supported?explicit.filter(claim=>{
    const candidate=claim.text;
    switch(field){
      case 'leadershipMode': return /hands[- ]on|execute|campaign|build|lead|manage|hire|team/i.test(candidate);
      case 'functionState': return /ground up|zero[- ]to[- ]one|doesn't exist|does not exist|set up|infrastructure|analytics|reporting/i.test(candidate);
      case 'commercialScope': return /P&L|profit|budget|revenue|commercial|acquisition|activation|retention|growth|funnel|channel/i.test(candidate);
      case 'organizationalStructure': return /(?:organizational|organisation|org)\s+structure|matrix(?:ed)?\s+(?:organization|organisation|structure)|functional\s+(?:organization|organisation|structure)|divisional\s+(?:organization|organisation|structure)|flat\s+(?:organization|organisation|structure)|centralized|decentralized|business units?|subsidiar(?:y|ies)/i.test(candidate);
      case 'teamScale': return /individual contributor|no direct reports?|without direct reports?|does not manage (?:a )?team|team|direct reports?|people/i.test(candidate);
      default:return false;
    }
  }).map(claim=>claim.id):[];
}

function hasIndependentExecutiveAltitudeEvidence(claimIds:string[],evidence:Claim[]):boolean{
  const byId=new Map(evidence.map(claim=>[claim.id,claim]));
  return claimIds.some(id=>{
    const claim=byId.get(id);
    if(!claim||claim.plane!=='JD'||claim.state!=='EXPLICIT')return false;
    const text=[claim.text,...claim.citations.map(citation=>citation.quote)].join(' ');
    return /\b(?:co[- ]?founder|founder\s*&|chief\s+[a-z ]+\s+officer|CEO|CMO|CFO|COO|CTO|president)\b/i.test(text);
  });
}

function validateResolutions(value: unknown, frozen: StagedResearchInput) {
  const drafts = normalizeUnverifiedCompanyAliasQuestions(
    normalizeSemanticallyUnsupportedContextResolutions(
      normalizeUnsupportedResolutionDrafts(
        stagedDecisionResolutionResponseSchema.parse(value).resolutions,
      ),
      frozen,
    ),
    frozen,
  );
  const parsed = materializeStagedDecisionResolutions(drafts);
  const claims = new Map(frozen.evidence.map(claim => [claim.id, claim]));
  const expected = new Set(frozen.fields);
  const knownClaimIds = new Set(claims.keys());
  const seen = new Set<string>();

  for (const resolution of parsed) {
    if (!expected.has(resolution.field) || !seen.add(resolution.field)) {
      throw new Error(`Resolve field exactly once: ${resolution.field}`);
    }
    exactIds(resolution.claimIds, knownClaimIds, `resolution ${resolution.field} claim`);
    const resolutionClaims=resolution.claimIds.map(id=>claims.get(id)!).filter(Boolean);
    if(resolutionClaims.some(claim=>claim.plane==='CANDIDATE')){
      throw new Error(`Role/company resolution cannot use candidate evidence: ${resolution.field}`);
    }
    if (resolution.status === 'OPEN' && (!resolution.question || resolution.value !== null)) {
      throw new Error(`Open field must become a question: ${resolution.field}`);
    }
    if (resolution.status === 'OPEN') {
      const directSupport=frozen.evidence.filter(claim=>claimDirectlyCoversField(resolution.field,claim));
      const semanticSupport=explicitRoleEvidenceSupportsField(resolution.field,frozen.evidence);
      const supportIds=[...new Set([...directSupport.map(claim=>claim.id),...semanticSupport])];
      if(supportIds.length){
        throw new Error(`OPEN field has sufficient validated evidence: ${resolution.field} (${supportIds.join(', ')})`);
      }
    }
    if (resolution.status !== 'OPEN' && (resolution.value === null || !resolution.claimIds.length)) {
      throw new Error(`Resolved field needs evidence: ${resolution.field}`);
    }
    if (resolution.status !== 'OPEN' && resolution.question !== undefined) {
      throw new Error(`Resolved field cannot carry a question: ${resolution.field}`);
    }
    if (resolution.status !== 'OPEN') {
      const textualValues = Array.isArray(resolution.value)
        ? resolution.value.filter((item): item is string => typeof item === 'string')
        : typeof resolution.value === 'string'
          ? [resolution.value]
          : [];
      if (textualValues.some(text => unsupportedCanonicalAlias(text, frozen))) {
        throw new Error(`Unsupported company alias assertion in resolved field: ${resolution.field}`);
      }
    }
    if (resolution.field === 'reportingLine' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.map(claim=>claim.text).join(' ');
      if(!/\b(?:reports?\s+(?:directly\s+)?to|reporting\s+(?:directly\s+)?to|manager\s+is|accountable\s+to)\b/i.test(support)){
        throw new Error('Reporting line requires reporting-topology evidence; collaboration or meeting cadence is insufficient');
      }
    }
    if (resolution.field === 'growth' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.flatMap(claim=>[claim.text,...claim.citations.map(citation=>citation.quote)]).join(' ');
      const value=String(resolution.value ?? '');
      if(/\b(?:career\s+growth|grow\s+into|senior\s+roles?|promotion|career\s+progression)\b/i.test(support)
        && !/\b(?:revenue|users?|customers?|sessions?|sales|headcount|workforce|company|business|market)\b/i.test(support)){
        throw new Error('Company growth cannot be resolved from candidate career-progression language');
      }
      if(/\b(?:funded|funding|investors?|raised|seed|series\s+[a-z])\b/i.test(value)
        && !/\b(?:funded|funding|investors?|raised|seed|series\s+[a-z])\b/i.test(support)){
        throw new Error('Growth cannot invent funding status that is absent from its cited evidence');
      }
      const money=value.match(/(?:[$£€₹]|\b(?:USD|INR|GBP|EUR)\s*)\s*\d[\d,.]*\s*[KMB]?\+?/gi) ?? [];
      if(money.some(token=>!support.toLocaleLowerCase().includes(token.toLocaleLowerCase().replace(/\s+/g,' ')))){
        throw new Error('Growth cannot introduce monetary scale that is absent from its cited evidence');
      }
    }
    if (resolution.field === 'workforceTrajectory' && resolution.status !== 'OPEN') {
      if(!resolutionClaims.some(claimEstablishesCompanyWorkforceMovement)){
        throw new Error('Workforce trajectory requires company-wide workforce movement; team descriptions, role growth, and career progression are insufficient');
      }
    }
    if (resolution.field === 'relatedHiring' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.flatMap(claim=>[claim.text,...claim.citations.map(citation=>citation.quote)]).join(' ');
      const otherHiring=/\b(?:also\s+hiring|hiring\s+(?:for|across)|recruiting\s+(?:for|across)|open\s+(?:roles|positions)|vacancies|other\s+(?:roles|positions)|multiple\s+(?:roles|positions)|job\s+openings?)\b/i.test(support);
      if(!otherHiring){
        throw new Error('Related hiring requires explicit evidence of other or multiple open roles; career progression language is insufficient');
      }
    }
    if (resolution.field === 'organizationalStructure' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.flatMap(claim=>[claim.text,...claim.citations.map(citation=>citation.quote)]).join(' ');
      const value=String(resolution.value ?? '');
      if(/\b(?:flat|matrix(?:ed)?|hierarchical|centralized|decentralized)\b/i.test(value)
        && !/\b(?:flat|matrix(?:ed)?|hierarchical|centralized|decentralized)\b/i.test(support)){
        throw new Error('Organizational structure cannot invent an org-design label absent from cited evidence');
      }
      if(/\b(?:co[- ]?founders?|founders?|CEOs?|chief executive)\b/i.test(value)
        && !/\b(?:co[- ]?founders?|founders?|CEOs?|chief executive)\b/i.test(support)){
        throw new Error('Organizational structure cannot introduce founder or CEO topology absent from cited evidence');
      }
    }
    if (resolution.field === 'leadershipChanges' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.map(claim=>claim.text).join(' ');
      const completedChange=/\b(?:appointed|named\s+(?:as\s+)?|promoted|joined\s+as|departed|left\s+(?:the\s+)?(?:company|business|role)|resigned|stepped\s+down|replaced|succeeded|succession|new\s+(?:CEO|CMO|CFO|COO|CTO|chief|president))\b/i.test(support);
      const openSearch=/\b(?:looking\s+for|seeking|recruiting|hiring|open\s+(?:role|position)|vacancy|to\s+join|join\s+at|role\s+is|position\s+is)\b/i.test(support);
      if(openSearch && !completedChange){
        throw new Error('Leadership changes require a completed appointment, departure, or succession event; an open leadership search is not a leadership change');
      }
    }
    if (resolution.field === 'marketExpansion' && resolution.status !== 'OPEN') {
      const support=resolutionClaims.map(claim=>claim.text).join(' ');
      const geographicOrCustomerMarket=hasGeographicOrCustomerMarketExpansion(support);
      const productCategoryExpansion=/\b(?:products?|flavou?r?s?|categories|functional benefits?|portfolio|range|sku)\b/i.test(support);
      if(/\b(?:hiring|hire|recruit|job\s+openings?|roles?)\b/i.test(support) && !geographicOrCustomerMarket){
        throw new Error('Market expansion cannot be inferred from hiring geography alone');
      }
      if(productCategoryExpansion && !geographicOrCustomerMarket){
        throw new Error('Market expansion requires geographic or customer-market evidence; product/category expansion is a different concept');
      }
    }
    if (resolution.field === 'teamScale' && resolution.status !== 'OPEN') {
      if(!resolutionClaims.some(claimEstablishesRolePeopleScale)){
        throw new Error('teamScale requires role-side people-management evidence; company headcount and brand/account/client/project counts are not team scale');
      }
    }
    if (resolution.field === 'executiveDistance' && resolution.status === 'RESOLVED') {
      throw new Error('Executive distance is an analytical derivation; label INFERRED');
    }
    if (resolution.field === 'executiveDistance' && resolution.value === 0) {
      const support = resolution.claimIds.map(id => claims.get(id)?.text ?? '').join(' ');
      if (!/\b(?:CEO|chief executive|company head|enterprise head|managing director)\b/i.test(support)) {
        throw new Error('Executive distance 0 is reserved for the company or enterprise head');
      }
      if (/\breports? to (?:the )?board\b/i.test(support)) {
        throw new Error('A vertical leader reporting to the Board is executive-distance 1, not company head');
      }
    }
    if (resolution.field === 'leadershipMode' && resolution.status !== 'OPEN' && /\bP&L(?:-equivalent)?\b|\bprofit\s*(?:and|&)\s*loss\b/i.test(String(resolution.value ?? ''))) {
      const support=resolutionClaims.map(claim=>claim.text).join(' ');
      if(!/\b(?:P&L|profit\s*(?:and|&)\s*loss|revenue ownership|owns?\s+revenue|budget ownership|owns?\s+(?:the\s+)?budget)\b/i.test(support)){
        throw new Error('Leadership mode cannot invent P&L-equivalent authority without explicit commercial-ownership evidence');
      }
    }
    if (['leadershipMode', 'functionState'].includes(resolution.field) && resolution.status === 'RESOLVED') {
      const labels = resolution.field === 'leadershipMode'
        ? /\b(?:DIRECT|MATRIX|HYBRID)\b/i
        : /\b(?:ESTABLISHED|SCALE-UP|GREENFIELD|RESTRUCTURE)\b/i;
      const quotes = resolution.claimIds
        .flatMap(id => claims.get(id)?.citations.map(citation => citation.quote) ?? [])
        .join(' ');
      if (!labels.test(quotes)) {
        throw new Error(`${resolution.field} is an analytical classification; label it INFERRED unless the source uses the classification itself`);
      }
    }
    if (resolution.field === 'teamScale' && resolution.status === 'RESOLVED' && resolution.value !== null) {
      const valueNumbers = String(resolution.value).match(/\d+/g) ?? [];
      const evidenceNumbers = resolution.claimIds.flatMap(id =>
        claims.get(id)?.citations.flatMap(citation => citation.quote.match(/\d+/g) ?? []) ?? []
      );
      if (valueNumbers.some(number => !evidenceNumbers.includes(number))) {
        throw new Error('Preserve the exact explicit team target; do not round it to an estimated band');
      }
    }
  }

  if (seen.size !== expected.size) {
    const missing = [...expected].filter(field => !seen.has(field));
    throw new Error(`Missing requested resolution fields: ${missing.join(', ')}`);
  }
  const byField=new Map(parsed.map(resolution=>[resolution.field,resolution]));
  const executiveDistance=byField.get('executiveDistance');
  const reportingLine=byField.get('reportingLine');
  if(
    executiveDistance &&
    executiveDistance.status!=='OPEN' &&
    reportingLine?.status==='OPEN' &&
    !hasIndependentExecutiveAltitudeEvidence(executiveDistance.claimIds,frozen.evidence)
  ){
    throw new Error('Executive distance requires reporting topology unless explicit founder/CxO authority independently establishes executive altitude');
  }
  return parsed;
}

export async function runStagedFrozenDecisionDetailed(
  frozen: StagedResearchInput,
  model: ReasoningModel,
  onStage: StageObserver = () => {},
): Promise<StagedDecisionResult> {
  const roleClaims = frozen.evidence.filter(claim => claim.plane === 'JD');
  const candidateClaims = frozen.evidence.filter(claim => claim.plane === 'CANDIDATE');
  if (!roleClaims.length || !candidateClaims.length) {
    throw new Error('Staged decision research requires validated JD and candidate evidence');
  }

  const role = await proposeStage(
    'Interpreting the role',
    model,
    stagedDecisionRoleInstruction,
    { opportunity: frozen.opportunity, roleClaims },
    stagedRoleAnalysisSchema,
    value => materializeStagedRoleAnalysis(value, roleClaims),
    onStage,
    'role-interpretation',
  );

  const roleClaimById = new Map(roleClaims.map(claim => [claim.id, claim]));
  const jdSourceIds = new Set(frozen.sources.filter(source => source.plane === 'JD').map(source => source.id));

  const quoteCatalogs = new Map(
    role.requirements.map(requirement => [
      requirement.id,
      buildScreeningQuoteCatalog(requirement, roleClaimById, jdSourceIds),
    ]),
  );
  const requirementChunks = chunkStagedDecisionItems(role.requirements);
  const [screeningChunks, mappingChunks] = await Promise.all([
    Promise.all(
      requirementChunks.map((requirements, chunkIndex) => {
        const ids = requirements.map(requirement => requirement.id);
        return proposeStage(
          `Adjudicating screening requirements — chunk ${chunkIndex + 1}/${requirementChunks.length}`,
          model,
          stagedDecisionScreeningInstruction +
            '\nBATCH MODE: adjudicate every supplied requirement exactly once. Return JSON {results:[{requirementId,adjudication:{screeningFunction,gateBasis,supportQuoteIds,reasoning}}]}. requirementId is application-owned and must be copied exactly.',
          {
            requirements: requirements.map(requirement => ({
              requirementId: requirement.id,
              requirement: {
                requirement: requirement.requirement,
                strength: requirement.strength,
                roleImportance: requirement.roleImportance,
              },
              quoteCatalog: quoteCatalogs.get(requirement.id),
            })),
          },
          screeningBatchSchema,
          value => {
            const parsed = screeningBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, ids, 'screening');
            return requirements.map(requirement =>
              materializeStagedScreeningAdjudication(
                byId.get(requirement.id)!.adjudication,
                requirement,
                quoteCatalogs.get(requirement.id)!,
              ),
            );
          },
          onStage,
          'screening-batch',
        );
      }),
    ),
    Promise.all(
      requirementChunks.map((requirements, chunkIndex) => {
        const ids = requirements.map(requirement => requirement.id);
        return proposeStage(
          `Mapping candidate evidence to requirements — chunk ${chunkIndex + 1}/${requirementChunks.length}`,
          model,
          stagedDecisionMappingInstruction +
            '\nBATCH MODE: map every supplied requirement exactly once. Return JSON {results:[{requirementId,mapping:{status,candidateClaimIds,unsupportedAspects,reasoning}}]}. Do not allow evidence for one requirement to satisfy another unless the supplied claims genuinely support both.',
          {
            opportunity: frozen.opportunity,
            requirements,
            candidateClaims,
            candidateConflicts: frozen.candidateConflicts,
          },
          mappingBatchSchema,
          value => {
            const parsed = mappingBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, ids, 'mapping');
            return requirements.map(requirement =>
              validateMapping(byId.get(requirement.id)!.mapping, candidateClaims),
            );
          },
          onStage,
          'candidate-mapping-batch',
        );
      }),
    ),
  ]);
  const screeningResults = screeningChunks.flat();
  const mappingResults = mappingChunks.flat();

  const requirements: StagedMappedRequirement[] = role.requirements.map((requirement, index) => ({
    ...requirement,
    screeningGate: screeningResults[index].screeningGate,
    screeningFunction: screeningResults[index].screeningFunction,
    screeningGateBasis: screeningResults[index].gateBasis,
    screeningSupportQuoteIds: screeningResults[index].supportQuoteIds,
    screeningReasoning: screeningResults[index].reasoning,
    status: mappingResults[index].status,
    candidateClaimIds: mappingResults[index].candidateClaimIds,
    unsupportedAspects: mappingResults[index].unsupportedAspects,
    mappingReasoning: mappingResults[index].reasoning,
    reasoning: requirement.reasoning,
  }));

  const resolutions = await proposeStage(
    'Resolving role and company context',
    model,
    stagedDecisionResolutionInstruction,
    {
      opportunity: frozen.opportunity,
      role,
      evidence: frozen.evidence,
      acquisition: frozen.acquisition,
      candidateConflicts:frozen.candidateConflicts,
      conflictInstruction:'These conflicts are unresolved. Do not choose a winner or treat a conflicting premise as settled.',
      fields: frozen.fields,
    },
    stagedDecisionResolutionResponseSchema,
    value => validateResolutions(value, frozen),
    onStage,
    'context-resolution',
  );

  const unresolvedGates = eligibleScreeningDrivers(requirements);
  const modelGates = unresolvedGates.filter(requirement => requirement.status !== 'CONTRADICTED');
  const modelGapResults = new Map<string, z.infer<typeof stagedGapResponseSchema>>();
  if (modelGates.length) {
    const gateChunks = chunkStagedDecisionItems(modelGates);
    const entries = await Promise.all(
      gateChunks.map((requirements, chunkIndex) =>
        proposeStage(
          `Classifying screening gaps — chunk ${chunkIndex + 1}/${gateChunks.length}`,
          model,
          stagedDecisionGapInstruction +
            '\nBATCH MODE: classify every supplied immutable screening gap exactly once. Return JSON {results:[{requirementId,gap:{gapNature,reasoning}}]}. Do not reopen screening or mapping judgments.',
          {
            opportunity: frozen.opportunity,
            requirements: requirements.map(requirement => ({
              requirementId: requirement.id,
              requirement: {
                id: requirement.id,
                requirement: requirement.requirement,
                strength: requirement.strength,
                roleImportance: requirement.roleImportance,
                screeningGate: requirement.screeningGate,
                screeningReasoning: requirement.screeningReasoning,
              },
              immutableMapping: {
                status: requirement.status,
                candidateClaimIds: requirement.candidateClaimIds,
                unsupportedAspects: requirement.unsupportedAspects,
                mappingReasoning: requirement.mappingReasoning,
              },
            })),
          },
          gapBatchSchema,
          value => {
            const parsed = gapBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, requirements.map(gate => gate.id), 'gap');
            return requirements.map(
              requirement =>
                [
                  requirement.id,
                  validateStagedGap(byId.get(requirement.id)!.gap, requirement),
                ] as const,
            );
          },
          onStage,
          'gap-classification-batch',
        ),
      ),
    );
    for (const [id, gap] of entries.flat()) modelGapResults.set(id, gap);
  }

  const gapResults = unresolvedGates.map(requirement =>
    requirement.status === 'CONTRADICTED'
      ? {
          gapNature: 'AFFIRMATIVE_CONFLICT' as const,
          reasoning: 'The immutable candidate mapping contains affirmative conflicting evidence.',
        }
      : modelGapResults.get(requirement.id)!,
  );

  const drivers: StagedScreeningDriver[] = unresolvedGates.map((requirement, index) => ({
    ...requirement,
    gapNature: gapResults[index].gapNature,
    gapReasoning: gapResults[index].reasoning,
  }));
  const screeningConstraint = screeningConstraintForDrivers(drivers);

  const careerCapital = await proposeStage(
    'Adjudicating career capital',
    model,
    stagedDecisionCareerCapitalInstruction,
    {
      candidateClaims,
      candidateDecisionProfile:frozen.candidateDecisionProfile,
      candidateConflicts:frozen.candidateConflicts,
      conflictInstruction:'Do not resolve candidate-source conflicts by choosing a winner.',
      operatingConditions: role.operatingConditions,
      authorityShape: role.authorityShape,
      resolutions,
    },
    stagedCareerCapitalSchema,
    value => validateStagedCareerCapital(value, role, resolutions, candidateClaims, true),
    onStage,
    'career-capital',
  );

  const immutableRequirements = requirements.map(requirement => ({
    id: requirement.id,
    requirement: requirement.requirement,
    strength: requirement.strength,
    roleImportance: requirement.roleImportance,
    screeningGate: requirement.screeningGate,
    status: requirement.status,
    unsupportedAspects: requirement.unsupportedAspects,
    mappingReasoning: requirement.mappingReasoning,
  }));

  const decision = await proposeStage(
    'Reasoning about pursuit decision',
    model,
    contextAwareDecisionInstruction,
    {
      opportunity: frozen.opportunity,
      candidate: frozen.candidate,
      candidateClaims,
      candidateDecisionProfile:frozen.candidateDecisionProfile,
      candidateConflicts:frozen.candidateConflicts,
      conflictInstruction:'Keep conflicts unresolved and express material uncertainty as decision hinges.',
      immutableRequirements,
      eligibleScreeningDrivers: drivers.map(driver => ({
        id: driver.id,
        requirement: driver.requirement,
        status: driver.status,
        unsupportedAspects: driver.unsupportedAspects,
        gapNature: driver.gapNature,
        gapReasoning: driver.gapReasoning,
      })),
      screeningConstraint,
      operatingConditions: role.operatingConditions,
      authorityShape: role.authorityShape,
      roleSideConditions: role.roleSideConditions,
      resolutions,
      careerCapital,
    },
    stagedDecisionProposalSchema,
    value => validateStagedDecisionModel(value, requirements, drivers, role, resolutions, careerCapital),
    onStage,
    'decision',
  );

  return {
    decision,
    trace: {
      role,
      requirements,
      resolutions,
      eligibleScreeningDrivers: drivers,
      screeningConstraint,
      decision,
    },
  };
}

export async function runStagedFrozenDecision(
  frozen: StagedResearchInput,
  model: ReasoningModel,
  onStage: StageObserver = () => {},
) {
  return (await runStagedFrozenDecisionDetailed(frozen, model, onStage)).decision;
}