/**
 * SourceIdExtractionHarness.ts
 *
 * Experimental Source-ID Semantic Extraction Harness for Gate 1B Batch 04B.
 *
 * Grounding & Provenance Invariants:
 * 1. Source units are provided as immutable `{ spanId, exactText }` items in the prompt.
 * 2. Models output strictly `{ spanId, ...semantics }` without offsets or quotes.
 * 3. The harness resolves `spanId` to the source unit's exactText and offsets.
 * 4. Grounding verification ensures 100% mechanical fidelity against the original source text.
 * 5. Rejects unknown span IDs and malformed envelopes.
 */

import type { SourceUnit } from "./MechanicalSourceSegmenter";
import {
  LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION,
  type LlmStructuredRequest,
  type LlmStructuredResponse,
} from "./LlmExperimentalExtractionProvider";
import {
  assembleRoleSemanticProposals,
  assembleCandidateSemanticProposals,
  type RoleSemanticProposal,
  type CandidateSemanticProposal,
  type SemanticAssemblyResult,
} from "./ExperimentalSemanticProposal";
import type {
  RoleIntelligenceOutputV1,
  RoleSemanticType,
  RoleSubject,
} from "./RoleIntelligenceExtractorV1";
import type {
  CandidateProofOutputV1,
  CandidateProofType,
  CandidateEvidenceClass,
} from "./CandidateProofExtractorV1";
import { MechanicalExtractionVerifier } from "./MechanicalExtractionVerifier";

export const SOURCE_ID_HARNESS_VERSION = "gate1b-batch04b/source-id-harness-v1";

const ROLE_TYPES = [
  "ROLE_PURPOSE", "RESPONSIBILITY", "OUTCOME", "SUCCESS_METRIC",
  "HARD_REQUIREMENT", "PREFERRED_REQUIREMENT", "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY", "BOARD_EXPOSURE", "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY", "PROFITABILITY_ACCOUNTABILITY", "BUDGET_SCOPE",
  "DECISION_AUTHORITY", "PEOPLE_LEADERSHIP", "PEOPLE_SCALE", "GREENFIELD_BUILD",
  "TRANSFORMATION", "GEOGRAPHIC_SCOPE", "REGULATORY_SCOPE", "PRODUCT_SCOPE",
  "CUSTOMER_SCOPE", "CHANNEL_SCOPE", "COMPANY_CONTEXT", "WORK_CONDITION",
] as const;

const ROLE_SUBJECTS = ["ROLE", "COMPANY", "RECRUITING_PROCESS"] as const;

const EVIDENCE_CLASSES = ["WORK_HISTORY", "SELF_SUMMARY", "CAPABILITY_LABEL"] as const;

const PROOF_TYPES = [
  "OUTCOME", "OWNERSHIP", "FINANCIAL_SCOPE", "PEOPLE_SCOPE", "GEOGRAPHIC_SCOPE",
  "ORGANIZATION_BUILD", "TRANSFORMATION", "MANDATE", "PRODUCT_LAUNCH",
  "CUSTOMER_GROWTH", "REVENUE_GROWTH", "COST_EFFICIENCY", "PIPELINE_GENERATION",
  "TECHNOLOGY_IMPLEMENTATION", "PARTNERSHIP", "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT", "CAPABILITY_LABEL",
] as const;

export interface RoleProposalBySourceId {
  readonly spanId: string;
  readonly semanticType?: RoleSemanticType;
  readonly subject: RoleSubject;
  readonly confidence: number;
}

export interface CandidateProposalBySourceId {
  readonly spanId: string;
  readonly evidenceClass: CandidateEvidenceClass;
  readonly proofTypes: readonly CandidateProofType[];
}

export function buildRolePromptWithSourceUnits(params: {
  readonly title: string;
  readonly company: string;
  readonly units: readonly SourceUnit[];
}): string {
  const unitLines = params.units.map(u => `[${u.spanId}] ${JSON.stringify(u.exactText)}`).join("\n");
  return [
    `You are an experimental role semantic extractor for RADAR v2 (Batch 04B).`,
    `Role Title: ${params.title}`,
    `Company: ${params.company}`,
    `Return JSON only, conforming strictly to the supplied schema.`,
    `For each semantic proposition present in the document, emit an object with its exact spanId from the SOURCE UNITS list below.`,
    `Do NOT emit exact quotes, character offsets, document identity, or summary metrics.`,
    `Valid subjects are: ROLE, COMPANY, RECRUITING_PROCESS.`,
    `Do not make recommendations, evaluate candidate fit, or invent facts absent from the source.`,
    ``,
    `SOURCE UNITS:`,
    unitLines
  ].join("\n");
}

export function buildCandidatePromptWithSourceUnits(params: {
  readonly documentId: string;
  readonly units: readonly SourceUnit[];
}): string {
  const unitLines = params.units.map(u => `[${u.spanId}] ${JSON.stringify(u.exactText)}`).join("\n");
  return [
    `You are an experimental candidate proof extractor for RADAR v2 (Batch 04B).`,
    `Document ID: ${params.documentId}`,
    `Return JSON only, conforming strictly to the supplied schema.`,
    `For each candidate proof claim or work history proposition, emit an object with its exact spanId from the SOURCE UNITS list below.`,
    `Classify each claim with its evidenceClass (WORK_HISTORY, SELF_SUMMARY, CAPABILITY_LABEL) and one or more proofTypes.`,
    `Do NOT emit exact quotes, character offsets, or invented metrics.`,
    `Do not make recommendations or invent facts absent from the source.`,
    ``,
    `SOURCE UNITS:`,
    unitLines
  ].join("\n");
}

export function getRoleJsonSchemaForVertex(units: readonly SourceUnit[]): Record<string, unknown> {
  const spanIds = units.map(u => u.spanId);
  return {
    type: "object",
    required: ["schemaVersion", "output"],
    properties: {
      schemaVersion: {
        type: "string",
        enum: [LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION]
      },
      output: {
        type: "object",
        required: ["proposals"],
        properties: {
          proposals: {
            type: "array",
            items: {
              type: "object",
              required: ["spanId", "subject", "confidence"],
              properties: {
                spanId: {
                  type: "string",
                  enum: spanIds
                },
                semanticType: {
                  type: "string",
                  enum: ROLE_TYPES
                },
                subject: {
                  type: "string",
                  enum: ROLE_SUBJECTS
                },
                confidence: {
                  type: "number",
                  minimum: 0,
                  maximum: 1
                }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  };
}

export function getCandidateJsonSchemaForVertex(units: readonly SourceUnit[]): Record<string, unknown> {
  const spanIds = units.map(u => u.spanId);
  return {
    type: "object",
    required: ["schemaVersion", "output"],
    properties: {
      schemaVersion: {
        type: "string",
        enum: [LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION]
      },
      output: {
        type: "object",
        required: ["proposals"],
        properties: {
          proposals: {
            type: "array",
            items: {
              type: "object",
              required: ["spanId", "evidenceClass", "proofTypes"],
              properties: {
                spanId: {
                  type: "string",
                  enum: spanIds
                },
                evidenceClass: {
                  type: "string",
                  enum: EVIDENCE_CLASSES
                },
                proofTypes: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "string",
                    enum: PROOF_TYPES
                  }
                }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  };
}

export interface GroundedUnitResult {
  readonly index: number;
  readonly spanId: string;
  readonly exactText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly validSpanId: boolean;
  readonly unique: boolean;
  readonly semanticType?: string;
  readonly subject?: string;
  readonly evidenceClass?: string;
  readonly proofTypes?: readonly string[];
  readonly confidence?: number;
}

export function resolveRoleResponseBySourceId(params: {
  readonly responseText: string;
  readonly sourceText: string;
  readonly canonicalJobId: string;
  readonly caseId?: string;
  readonly units: readonly SourceUnit[];
}): {
  readonly envelopeValid: boolean;
  readonly parsedProposals: number;
  readonly validSpanIdCount: number;
  readonly invalidSpanIds: readonly string[];
  readonly grounding: readonly GroundedUnitResult[];
  readonly assembly: SemanticAssemblyResult<RoleIntelligenceOutputV1> | null;
  readonly verificationError: string | null;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(params.responseText);
  } catch (err) {
    return {
      envelopeValid: false,
      parsedProposals: 0,
      validSpanIdCount: 0,
      invalidSpanIds: [],
      grounding: [],
      assembly: null,
      verificationError: `JSON parse failed: ${String(err)}`
    };
  }

  const envelopeValid = (
    parsed &&
    typeof parsed === "object" &&
    parsed.schemaVersion === LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION &&
    parsed.output &&
    Array.isArray(parsed.output.proposals)
  );

  if (!envelopeValid) {
    return {
      envelopeValid: false,
      parsedProposals: 0,
      validSpanIdCount: 0,
      invalidSpanIds: [],
      grounding: [],
      assembly: null,
      verificationError: "Invalid envelope schema"
    };
  }

  const unitMap = new Map<string, SourceUnit>(params.units.map(u => [u.spanId, u]));
  const invalidSpanIds: string[] = [];
  const convertedProposals: RoleSemanticProposal[] = [];
  const grounding: GroundedUnitResult[] = [];

  for (let idx = 0; idx < parsed.output.proposals.length; idx++) {
    const p = parsed.output.proposals[idx];
    const unit = unitMap.get(p.spanId);
    if (!unit) {
      invalidSpanIds.push(p.spanId);
      grounding.push({
        index: idx,
        spanId: p.spanId,
        exactText: "",
        startOffset: -1,
        endOffset: -1,
        validSpanId: false,
        unique: false,
        semanticType: p.semanticType,
        subject: p.subject,
        confidence: p.confidence
      });
      continue;
    }

    // Verify unit grounding in source text
    const slice = params.sourceText.slice(unit.startOffset, unit.endOffset);
    const unique = (
      params.sourceText.indexOf(unit.exactText) === unit.startOffset &&
      params.sourceText.indexOf(unit.exactText, unit.startOffset + 1) === -1
    );

    grounding.push({
      index: idx,
      spanId: p.spanId,
      exactText: unit.exactText,
      startOffset: unit.startOffset,
      endOffset: unit.endOffset,
      validSpanId: true,
      unique,
      semanticType: p.semanticType,
      subject: p.subject,
      confidence: p.confidence
    });

    convertedProposals.push({
      exactQuote: unit.exactText,
      semanticType: p.semanticType,
      subject: p.subject,
      confidence: p.confidence
    });
  }

  let assembly: SemanticAssemblyResult<RoleIntelligenceOutputV1> | null = null;
  let verificationError: string | null = null;

  try {
    assembly = assembleRoleSemanticProposals({
      sourceText: params.sourceText,
      caseId: params.caseId ?? params.canonicalJobId,
      canonicalJobId: params.canonicalJobId,
      proposals: convertedProposals
    });

    const sourceRef = {
      kind: "OPPORTUNITY_VERSION" as const,
      canonicalJobId: params.canonicalJobId,
      opportunityVersion: "1",
      contentHash: "synthetic",
      sourcePayloadKey: null,
      sourcePayloadSha256: null
    };

    new MechanicalExtractionVerifier().verifyRole(
      sourceRef,
      { ref: sourceRef, text: params.sourceText } as any,
      assembly.output
    );
  } catch (err) {
    verificationError = String(err);
  }

  return {
    envelopeValid,
    parsedProposals: parsed.output.proposals.length,
    validSpanIdCount: grounding.filter(g => g.validSpanId).length,
    invalidSpanIds,
    grounding,
    assembly,
    verificationError
  };
}

export function resolveCandidateResponseBySourceId(params: {
  readonly responseText: string;
  readonly sourceText: string;
  readonly sourceDocumentId: string;
  readonly units: readonly SourceUnit[];
}): {
  readonly envelopeValid: boolean;
  readonly parsedProposals: number;
  readonly validSpanIdCount: number;
  readonly invalidSpanIds: readonly string[];
  readonly grounding: readonly GroundedUnitResult[];
  readonly assembly: SemanticAssemblyResult<CandidateProofOutputV1> | null;
  readonly verificationError: string | null;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(params.responseText);
  } catch (err) {
    return {
      envelopeValid: false,
      parsedProposals: 0,
      validSpanIdCount: 0,
      invalidSpanIds: [],
      grounding: [],
      assembly: null,
      verificationError: `JSON parse failed: ${String(err)}`
    };
  }

  const envelopeValid = (
    parsed &&
    typeof parsed === "object" &&
    parsed.schemaVersion === LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION &&
    parsed.output &&
    Array.isArray(parsed.output.proposals)
  );

  if (!envelopeValid) {
    return {
      envelopeValid: false,
      parsedProposals: 0,
      validSpanIdCount: 0,
      invalidSpanIds: [],
      grounding: [],
      assembly: null,
      verificationError: "Invalid envelope schema"
    };
  }

  const unitMap = new Map<string, SourceUnit>(params.units.map(u => [u.spanId, u]));
  const invalidSpanIds: string[] = [];
  const convertedProposals: CandidateSemanticProposal[] = [];
  const grounding: GroundedUnitResult[] = [];

  for (let idx = 0; idx < parsed.output.proposals.length; idx++) {
    const p = parsed.output.proposals[idx];
    const unit = unitMap.get(p.spanId);
    if (!unit) {
      invalidSpanIds.push(p.spanId);
      grounding.push({
        index: idx,
        spanId: p.spanId,
        exactText: "",
        startOffset: -1,
        endOffset: -1,
        validSpanId: false,
        unique: false,
        evidenceClass: p.evidenceClass,
        proofTypes: p.proofTypes
      });
      continue;
    }

    const unique = (
      params.sourceText.indexOf(unit.exactText) === unit.startOffset &&
      params.sourceText.indexOf(unit.exactText, unit.startOffset + 1) === -1
    );

    grounding.push({
      index: idx,
      spanId: p.spanId,
      exactText: unit.exactText,
      startOffset: unit.startOffset,
      endOffset: unit.endOffset,
      validSpanId: true,
      unique,
      evidenceClass: p.evidenceClass,
      proofTypes: p.proofTypes
    });

    convertedProposals.push({
      exactQuote: unit.exactText,
      evidenceClass: p.evidenceClass,
      proofTypes: p.proofTypes
    });
  }

  let assembly: SemanticAssemblyResult<CandidateProofOutputV1> | null = null;
  let verificationError: string | null = null;

  try {
    assembly = assembleCandidateSemanticProposals({
      sourceText: params.sourceText,
      sourceDocumentId: params.sourceDocumentId,
      proposals: convertedProposals
    });

    const candidateSourceRef = {
      kind: "CANDIDATE_DOCUMENT_TEXT" as const,
      personId: "person-synthetic",
      documentId: params.sourceDocumentId,
      documentHash: "synthetic",
      textHash: "synthetic",
    };

    new MechanicalExtractionVerifier().verifyCandidate(
      candidateSourceRef,
      { ref: candidateSourceRef, text: params.sourceText } as any,
      assembly.output
    );
  } catch (err) {
    verificationError = String(err);
  }

  return {
    envelopeValid,
    parsedProposals: parsed.output.proposals.length,
    validSpanIdCount: grounding.filter(g => g.validSpanId).length,
    invalidSpanIds,
    grounding,
    assembly,
    verificationError
  };
}
