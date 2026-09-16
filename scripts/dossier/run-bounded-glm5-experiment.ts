import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import {
  applyScreeningAdjudication,
  assembleBoundedAnalyticalResult,
  boundedDecisionSchema,
  candidateMappingSchema,
  roleAnalyticalCoreSchema,
  screeningAdjudicationSchema,
  stageFingerprint,
  validateBoundedDecision,
  validateCandidateMapping,
  validateRoleAnalyticalCore,
  validateScreeningAdjudication,
} from '../../src/dossier/bounded-research-experiment';
import { researchInputFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';

const cases = [
  {
    key: 'schnell',
    frozenPath: '.radar/dossier-runs/schnell-real-frozen-research-input.json',
    expectedFingerprint: '2d1a8f361f880f08f2980cf19df79828f1860d446036af46042468c99c7d3bb0',
  },
  {
    key: 'artificilux',
    frozenPath: '.radar/dossier-runs/artificilux-real-frozen-research-input.json',
    expectedFingerprint: '7dc7cb6b568b76a2eba98e83d98ea6134f9eb793139318e238430944d8a8bda0',
  },
  {
    key: '2070',
    frozenPath: '.radar/dossier-runs/2070-real-frozen-research-input.json',
    expectedFingerprint: '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c',
  },
] as const;

const artifactPath = '.radar/dossier-runs/three-case-bounded-research-architecture-experiment-v3.json';
const modelId = 'zai.glm-5';

const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
if (!apiKey) {
  throw new Error('AWS_BEARER_TOKEN_BEDROCK is required');
}

const schemas = {
  role: bedrockJsonSchema(roleAnalyticalCoreSchema),
  screening: bedrockJsonSchema(screeningAdjudicationSchema),
  mapping: bedrockJsonSchema(candidateMappingSchema),
  decision: bedrockJsonSchema(boundedDecisionSchema),
};
const schemaHashes = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
  ]),
);

const model = new BedrockConverseJsonModel(
  modelId,
  async () => apiKey,
  fetch,
  { maxOutputTokens: 8192, timeoutMs: 600000 },
);

const roleInstruction = `You are Stage 1A of a bounded executive-opportunity analysis. Analyze only validated JD claims and return a RoleAnalyticalCore.

Separate candidate requirements from role operating conditions and role-side/process conditions.

A candidate requirement is a trait, experience, capability, credential, or qualifying artifact the employer expects the candidate to bring or demonstrate. Classify each candidate requirement only on:
- strength: REQUIRED or PREFERRED;
- roleImportance: CORE_CAPABILITY or ENABLER.

Do NOT decide whether any requirement is an employer screening gate. A separate adjudication stage owns that judgment.

A role operating condition describes how the job itself operates: authority topology, individual-contributor versus people-manager structure, hands-on execution expectations, reporting shape, operating cadence, role scope, work arrangement, and employment conditions.

Application mechanics such as a required covering note, submission format, interview step, or other application-process instruction belong in roleSideConditions, not candidate requirements. They may affect pursuit process, but they are not candidate-evidence attributes.

A JD claim may legitimately support more than one derived semantic conclusion when it carries multiple meanings. Do not force evidence ancestry to be mutually exclusive.

Do not infer anything about a candidate. Cite only supplied JD claim IDs. Do not create claims.`;

const screeningInstruction = `You are Stage 1B of a bounded executive-opportunity analysis. The role interpretation is immutable. Decide only whether each candidate requirement is an explicit employer-side pre-entry screening gate.

Return exactly one decision for every supplied requirement and no others.

Use the exact JD citation quotes as the authoritative source for screening force. The extracted claim text is contextual help only; if the paraphrased claim strengthens the source wording, follow the exact quote instead.

screeningGate=true only when the exact source establishes a genuine candidate-entry or shortlisting condition. Examples of general categories that can qualify include quantified minimum experience thresholds, explicit required credentials or licences, explicit candidate eligibility conditions, and qualifying artifacts such as a required portfolio when the source presents them as candidate qualifications.

A responsibility, success capability, operating expectation, or placement under a heading such as 'What We're Looking For' does not by itself establish a screening gate. REQUIRED capability is not synonymous with screening gate. PREFERRED requirements can never be screening gates.

Do not reason about the candidate. Do not change requirement text, strength, roleImportance, or evidence. Return only requirementId, screeningGate, and concise reasoning.`;

const mappingInstruction = `You are Stage 2 of a bounded executive-opportunity analysis. The screened role contract is already validated and immutable.

Map every and only its candidate requirements to supplied candidate evidence using exactly DIRECT, ADJACENT, TRANSFERABLE, NOT_EVIDENCED, or CONTRADICTED.

For every mapping, return unsupportedAspects: a list of material parts of the requirement that the supplied candidate evidence does not establish. DIRECT is allowed only when the requirement is fully evidenced and unsupportedAspects is empty. If a composite requirement has a material sub-part that is not directly evidenced, do not label the whole requirement DIRECT; use ADJACENT, TRANSFERABLE, or NOT_EVIDENCED as appropriate.

Positive statuses require actual supplied candidate claim IDs. CONTRADICTED requires affirmative candidate evidence that conflicts with the requirement; missing evidence is NOT_EVIDENCED, never CONTRADICTED.

Do not add or modify requirements, strength, roleImportance, screeningGate, or operating conditions. Separately return factual authority/commercial observations when supplied candidate evidence supports them; this array may be empty.

Never infer desire, willingness, flight risk, retention risk, or candidate preference from missing evidence. Do not create claims.`;

const decisionInstruction = `You are Stage 3 of a bounded executive-opportunity analysis. Use the immutable screened role contract and requirement mapping.

Return only:
- screening viability;
- screening rationale;
- screeningDriverRequirementIds;
- pursuit verdict;
- concise decision rationale;
- career-capital/authority trade;
- decision hinges with typed references.

Every screeningDriverRequirementId must point to an immutable requirement whose screeningGate is true. Employer screening viability may be driven only by screeningGate=true requirements.

Role operating shape, authority change, employment conditions, compensation, location, application-process mechanics, or candidate willingness cannot become employer screening drivers.

BLOCKED means the current employer doorway is not realistically passable on the evidence now available and requires verdict PASS. Do not return PURSUE merely because the employer might hypothetically waive explicit gates. A possible waiver can be a decision hinge, not the current recommendation.

Distinguish a substantive eligibility gap from a missing but plausibly obtainable artifact or verification. Where an explicit gate is unresolved because a specific artifact or proof may still be supplied, consider FRAGILE rather than automatically treating it as BLOCKED. Base the judgment on the actual mapping and source meaning.

Treat authority/headcount/commercial-scope differences as candidate-side career-capital reasoning. Do not invent personal preference, desire, willingness, flight risk, retention risk, or employer concern.

Decision hinge refs must use the typed namespaces supplied by the contract: ROLE_REQUIREMENT, ROLE_CLAIM, CANDIDATE_CLAIM, CONTEXT_CLAIM, or OPERATING_CONDITION. Do not put requirement IDs into evidence-claim namespaces.

Do not create requirements, mappings, claims, narrative plans, resolutions, or acquisition requests.`;

type ExperimentCaseRecord = {
  sourceFrozenArtifact: string;
  frozenFingerprint: string;
  opportunity?: FrozenResearchInput['opportunity'];
  evidenceVolumes?: {
    roleClaims: number;
    candidateClaims: number;
    contextClaims: number;
    candidateConflicts: number;
  };
  stages: Record<string, unknown>;
  status: 'PENDING' | 'RUNNING' | 'ACCEPTED' | 'FAILED';
  assembled: unknown | null;
  error: string | null;
};

const caseRecords: Record<string, ExperimentCaseRecord> = {};

const persist = async (status: 'RUNNING' | 'ACCEPTED' | 'FAILED') => {
  await writeFile(artifactPath, JSON.stringify({
    experiment: 'bounded-research-v3-isolated-screening',
    model: {
      provider: model.id,
      version: model.version,
      endpoint: 'bedrock-runtime/converse',
      region: 'us-east-1',
    },
    schemas: schemaHashes,
    caseOrder: cases.map(item => item.key),
    status,
    cases: caseRecords,
  }, null, 2));
};

async function runStage<T>(
  caseRecord: ExperimentCaseRecord,
  name: string,
  instruction: string,
  input: unknown,
  schema: Record<string, unknown>,
  validate: (raw: unknown) => T,
): Promise<T> {
  const startedAt = Date.now();
  const inputFingerprint = stageFingerprint(input);
  let rawResponse: unknown = null;

  try {
    rawResponse = await model.generate(instruction, input, schema);
    caseRecord.stages[name] = {
      inputFingerprint,
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
      validation: { status: 'PENDING' },
    };
    await persist('RUNNING');

    const validated = validate(rawResponse);
    caseRecord.stages[name] = {
      ...(caseRecord.stages[name] as object),
      validated,
      validation: { status: 'ACCEPTED' },
    };
    await persist('RUNNING');
    return validated;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Unknown stage failure';
    caseRecord.stages[name] = {
      inputFingerprint,
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
      validation: { status: 'REJECTED', error: message },
    };
    throw failure;
  }
}

await mkdir('.radar/dossier-runs', { recursive: true });

for (const experimentCase of cases) {
  const caseRecord: ExperimentCaseRecord = {
    sourceFrozenArtifact: experimentCase.frozenPath,
    frozenFingerprint: experimentCase.expectedFingerprint,
    stages: {},
    status: 'PENDING',
    assembled: null,
    error: null,
  };
  caseRecords[experimentCase.key] = caseRecord;

  try {
    const frozen = JSON.parse(
      await readFile(experimentCase.frozenPath, 'utf8'),
    ) as FrozenResearchInput;

    if (
      frozen.fingerprint !== experimentCase.expectedFingerprint
      || researchInputFingerprint(frozen) !== experimentCase.expectedFingerprint
    ) {
      throw new Error(`Unexpected frozen research input for ${experimentCase.key}`);
    }

    const roleClaims = frozen.evidence.filter(claim => claim.plane === 'JD');
    const candidateClaims = frozen.evidence.filter(claim => claim.plane === 'CANDIDATE');
    const contextClaims = frozen.evidence.filter(claim => claim.plane === 'CONTEXT');
    const jdSourceIds = new Set(
      frozen.sources.filter(source => source.plane === 'JD').map(source => source.id),
    );
    const roleClaimById = new Map(roleClaims.map(claim => [claim.id, claim]));

    caseRecord.opportunity = frozen.opportunity;
    caseRecord.evidenceVolumes = {
      roleClaims: roleClaims.length,
      candidateClaims: candidateClaims.length,
      contextClaims: contextClaims.length,
      candidateConflicts: frozen.candidateConflicts.length,
    };
    caseRecord.status = 'RUNNING';
    await persist('RUNNING');

    const roleInput = { opportunity: frozen.opportunity, roleClaims };
    const role = await runStage(
      caseRecord,
      'roleAnalysis',
      roleInstruction,
      roleInput,
      schemas.role,
      raw => validateRoleAnalyticalCore(raw, roleClaims),
    );

    const screeningInput = {
      opportunity: frozen.opportunity,
      requirements: role.requirements.map(requirement => ({
        id: requirement.id,
        requirement: requirement.requirement,
        strength: requirement.strength,
        roleImportance: requirement.roleImportance,
        evidence: requirement.roleClaimIds.map(claimId => {
          const claim = roleClaimById.get(claimId)!;
          return {
            claimId,
            extractedClaimText: claim.text,
            exactJdQuotes: (claim.citations ?? [])
              .filter(citation => jdSourceIds.has(citation.sourceId))
              .map(citation => citation.quote),
          };
        }),
      })),
    };
    const screening = await runStage(
      caseRecord,
      'screeningAdjudication',
      screeningInstruction,
      screeningInput,
      schemas.screening,
      raw => validateScreeningAdjudication(raw, role),
    );
    const screenedRole = applyScreeningAdjudication(role, screening);
    caseRecord.stages.roleContract = {
      assembledFrom: ['roleAnalysis', 'screeningAdjudication'],
      validated: screenedRole,
    };
    await persist('RUNNING');

    const mappingInput = {
      role: screenedRole,
      candidateClaims,
      candidateConflicts: frozen.candidateConflicts,
    };
    const mapping = await runStage(
      caseRecord,
      'candidateMapping',
      mappingInstruction,
      mappingInput,
      schemas.mapping,
      raw => validateCandidateMapping(raw, screenedRole, candidateClaims),
    );

    const authorityClaimIds = [
      ...new Set(mapping.authorityFacts.flatMap(item => item.claimIds)),
    ];
    const authorityEvidence = candidateClaims.filter(claim =>
      authorityClaimIds.includes(claim.id),
    );

    const decisionInput = {
      opportunity: frozen.opportunity,
      role: screenedRole,
      mapping,
      contextClaims,
      authorityEvidence,
      referenceNamespaces: {
        roleRequirementIds: screenedRole.requirements.map(item => item.id),
        operatingConditionIds: screenedRole.operatingConditions.map(item => item.id),
        roleClaimIds: roleClaims.map(item => item.id),
        candidateClaimIds: candidateClaims.map(item => item.id),
        contextClaimIds: contextClaims.map(item => item.id),
      },
    };
    const decision = await runStage(
      caseRecord,
      'decisionReasoning',
      decisionInstruction,
      decisionInput,
      schemas.decision,
      raw => validateBoundedDecision(raw, screenedRole, mapping, contextClaims, candidateClaims),
    );

    caseRecord.assembled = assembleBoundedAnalyticalResult(screenedRole, mapping, decision);
    caseRecord.status = 'ACCEPTED';
    await persist('RUNNING');
    console.log(`${experimentCase.key}: accepted`);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Unknown case failure';
    caseRecord.status = 'FAILED';
    caseRecord.error = message;
    await persist('RUNNING');
    console.log(`${experimentCase.key}: rejected — ${message}`);
  }
}

const allAccepted = cases.every(item => caseRecords[item.key]?.status === 'ACCEPTED');
await persist(allAccepted ? 'ACCEPTED' : 'FAILED');
console.log(allAccepted ? 'experiment: accepted' : 'experiment: rejected');
