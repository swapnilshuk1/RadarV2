/**
 * RichSemanticPropositionContract.ts
 *
 * Frozen experimental contract for RADAR Gate 1B Batch 04C:
 * RICH SEMANTIC PROPOSITION GENERALIZATION AND ARCHITECTURE COMPARISON.
 *
 * STRICT INVARIANTS:
 * 1. Read-Only Provenance: sourceEvidence cites deterministic SourceUnits [S001]..[SNNN].
 * 2. Generated text is interpretation, NOT authoritative source truth.
 * 3. 100% mechanical fail-closed: unresolvable span IDs reject the proposition.
 * 4. Polarity preservation: NEGATED and CONDITIONAL statements never collapse into affirmative authority.
 * 5. Applicability isolation: CANDIDATE_REQUIREMENT never projects into active ROLE authority.
 * 6. Frozen before fresh holdout inspection.
 */

import type { RoleSemanticType } from "./RoleIntelligenceExtractorV1";
import type { SourceUnit } from "./MechanicalSourceSegmenter";

export const RICH_CONTRACT_VERSION = "rich-semantic-proposition/v1";
export const RICH_PROMPT_VERSION = "rich-proposition-prompt/v1";
export const RICH_SCHEMA_VERSION = "rich-proposition-schema/v1";
export const RICH_PROJECTION_VERSION = "rich-canonical-projection/v1";

export type PropositionApplicability =
  | "ROLE"
  | "CANDIDATE_REQUIREMENT"
  | "CANDIDATE_PREFERENCE"
  | "COMPANY"
  | "RECRUITING_PROCESS";

export type PropositionPolarity =
  | "AFFIRMED"
  | "NEGATED"
  | "CONDITIONAL";

export type OntologyDisposition =
  | "MAPPED"
  | "PARTIALLY_MAPPED"
  | "UNMAPPED_MATERIAL";

export interface GroundedSemanticProposition {
  readonly proposition: string;
  readonly appliesTo: PropositionApplicability;
  readonly polarity: PropositionPolarity;
  readonly conditionDescription?: string | null;
  readonly sourceEvidence: readonly string[];
  readonly canonicalTypes: readonly RoleSemanticType[];
  readonly ontologyDisposition: OntologyDisposition;
  readonly unmappedConceptDescription?: string | null;
  readonly confidence: number;
}

export interface RichPropositionExtractionResponse {
  readonly propositions: readonly GroundedSemanticProposition[];
}

export const CANONICAL_ROLE_TYPES: readonly RoleSemanticType[] = [
  "ROLE_PURPOSE",
  "RESPONSIBILITY",
  "OUTCOME",
  "SUCCESS_METRIC",
  "HARD_REQUIREMENT",
  "PREFERRED_REQUIREMENT",
  "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY",
  "BOARD_EXPOSURE",
  "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY",
  "PROFITABILITY_ACCOUNTABILITY",
  "BUDGET_SCOPE",
  "DECISION_AUTHORITY",
  "PEOPLE_LEADERSHIP",
  "PEOPLE_SCALE",
  "GREENFIELD_BUILD",
  "TRANSFORMATION",
  "GEOGRAPHIC_SCOPE",
  "REGULATORY_SCOPE",
  "PRODUCT_SCOPE",
  "CUSTOMER_SCOPE",
  "CHANNEL_SCOPE",
  "COMPANY_CONTEXT",
  "WORK_CONDITION",
];

export const RICH_PROPOSITION_JSON_SCHEMA_VERTEX = {
  type: "OBJECT",
  properties: {
    propositions: {
      type: "ARRAY",
      description: "List of atomic, grounded semantic propositions extracted from the source units.",
      items: {
        type: "OBJECT",
        properties: {
          proposition: {
            type: "STRING",
            description: "Concise, precise statement of the factual proposition conveyed by the cited text."
          },
          appliesTo: {
            type: "STRING",
            enum: [
              "ROLE",
              "CANDIDATE_REQUIREMENT",
              "CANDIDATE_PREFERENCE",
              "COMPANY",
              "RECRUITING_PROCESS"
            ],
            description: "The entity domain this proposition describes."
          },
          polarity: {
            type: "STRING",
            enum: ["AFFIRMED", "NEGATED", "CONDITIONAL"],
            description: "AFFIRMED if active/required; NEGATED if explicitly denied/excluded/not this role; CONDITIONAL if contingent on board approval, milestones, or exceptional criteria."
          },
          conditionDescription: {
            type: "STRING",
            description: "If CONDITIONAL, describe the condition or qualification. Otherwise empty string."
          },
          sourceEvidence: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "List of 1 or more source unit IDs (e.g. S001, S015) supporting this exact finding."
          },
          canonicalTypes: {
            type: "ARRAY",
            items: {
              type: "STRING",
              enum: CANONICAL_ROLE_TYPES as unknown as string[]
            },
            description: "Zero, one, or more applicable canonical RADAR semantic types."
          },
          ontologyDisposition: {
            type: "STRING",
            enum: ["MAPPED", "PARTIALLY_MAPPED", "UNMAPPED_MATERIAL"],
            description: "MAPPED if canonicalTypes fully capture it; PARTIALLY_MAPPED if only partially captured; UNMAPPED_MATERIAL if materially important but omitted from the 25 types."
          },
          unmappedConceptDescription: {
            type: "STRING",
            description: "If UNMAPPED_MATERIAL or PARTIALLY_MAPPED, brief description of the unmapped concept. Otherwise empty string."
          },
          confidence: {
            type: "NUMBER",
            description: "Confidence from 0.0 to 1.0."
          }
        },
        required: [
          "proposition",
          "appliesTo",
          "polarity",
          "sourceEvidence",
          "canonicalTypes",
          "ontologyDisposition",
          "confidence"
        ]
      }
    }
  },
  required: ["propositions"]
};

export function buildRichPropositionPrompt(units: readonly SourceUnit[]): string {
  const formattedUnits = units.map(u => `[${u.spanId}] ${u.exactText}`).join("\n\n");

  return `You are RADAR v2 Executive Job Intelligence Semantic Extraction Engine.
Analyze the following numbered source units [S001]..[SNNN] extracted from an executive job description.

Your objective is to extract atomic, grounded factual propositions that describe the opportunity accurately and completely.

CRITICAL EXTRACTION GUIDELINES:

1. SOURCE CITATIONS:
- Every proposition MUST cite one or more source unit IDs in \`sourceEvidence\` (e.g. ["S001"] or ["S014", "S015"]).
- Do NOT invent span IDs. Every cited ID must be present in the provided text.
- One source unit may support multiple propositions (e.g. an MBA preference and a bachelor's requirement in the same unit).
- Multiple units may be combined if they form a single factual finding.

2. APPLICABILITY DOMAINS:
- \`ROLE\`: Direct mandate, active responsibilities, active P&L, KPIs, reporting lines, team to build, compensation, work conditions.
- \`CANDIDATE_REQUIREMENT\`: Mandatory qualifications, minimum years, past leadership experience, mandatory degree. Note: A candidate's *past* P&L experience is a CANDIDATE_REQUIREMENT, NOT an active ROLE P&L!
- \`CANDIDATE_PREFERENCE\`: Desirable/preferred background, nice-to-have industries or credentials.
- \`COMPANY\`: Company history, legacy projects, credentials, corporate overview.
- \`RECRUITING_PROCESS\`: Application instructions, covering note mandate, portfolio submission, HR email.

3. POLARITY & MODALITY:
- \`AFFIRMED\`: True affirmative responsibilities, requirements, and facts.
- \`NEGATED\`: Explicit exclusions, boundaries, or non-ownership (e.g. "not joining an existing line", "not an ivory tower role", "no pre-qualified leads provided").
- \`CONDITIONAL\`: Contingent authority, approval-gated mandates (e.g. "execute vertical charter after Board approval"), or conditional compensation.

4. CANONICAL ONTOLOGY MAPPING:
Where applicable, map the finding to one or more of RADAR's canonical 25 types:
ROLE_PURPOSE, RESPONSIBILITY, OUTCOME, SUCCESS_METRIC, HARD_REQUIREMENT, PREFERRED_REQUIREMENT,
REPORTING_LINE, FOUNDER_CEO_PROXIMITY, BOARD_EXPOSURE, PNL_OWNERSHIP, REVENUE_ACCOUNTABILITY,
PROFITABILITY_ACCOUNTABILITY, BUDGET_SCOPE, DECISION_AUTHORITY, PEOPLE_LEADERSHIP, PEOPLE_SCALE,
GREENFIELD_BUILD, TRANSFORMATION, GEOGRAPHIC_SCOPE, REGULATORY_SCOPE, PRODUCT_SCOPE,
CUSTOMER_SCOPE, CHANNEL_SCOPE, COMPANY_CONTEXT, WORK_CONDITION.

If a material executive concept is NOT adequately covered by the 25 types (e.g. internal governance walls, incentive clawback, fiduciary conflict management), set \`ontologyDisposition\` to "UNMAPPED_MATERIAL" or "PARTIALLY_MAPPED" and describe it in \`unmappedConceptDescription\`.

5. FIDELITY & RESTRAINT:
- Extract facts faithfully. Do NOT invent reporting to CEO or Board if only Directors are mentioned.
- Do NOT assume company-wide P&L if only vertical or division P&L is stated.
- Do NOT hallucinate team sizes or revenue numbers not present in the text.

SOURCE UNITS:
${formattedUnits}
`;
}

export interface ProjectedCanonicalAtom {
  readonly propositionIndex: number;
  readonly canonicalType: RoleSemanticType;
  readonly subject: "ROLE" | "COMPANY" | "RECRUITING_PROCESS";
  readonly exactText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly spanId: string;
  readonly polarity: PropositionPolarity;
  readonly conditionDescription?: string | null;
  readonly propositionText: string;
}

export interface CanonicalProjectionResult {
  readonly acceptedAtoms: readonly ProjectedCanonicalAtom[];
  readonly rejectedPropositions: readonly { readonly index: number; readonly reason: string }[];
  readonly unmappedMaterialCount: number;
  readonly negativeBoundaryCount: number;
}

export function projectPropositionsToCanonical(
  propositions: readonly GroundedSemanticProposition[],
  unitMap: ReadonlyMap<string, SourceUnit>
): CanonicalProjectionResult {
  const acceptedAtoms: ProjectedCanonicalAtom[] = [];
  const rejectedPropositions: { index: number; reason: string }[] = [];
  let unmappedMaterialCount = 0;
  let negativeBoundaryCount = 0;

  for (let i = 0; i < propositions.length; i++) {
    const p = propositions[i];

    if (!p.sourceEvidence || p.sourceEvidence.length === 0) {
      rejectedPropositions.push({ index: i, reason: "NO_SOURCE_EVIDENCE" });
      continue;
    }

    const invalidSpans = p.sourceEvidence.filter(id => !unitMap.has(id));
    if (invalidSpans.length > 0) {
      rejectedPropositions.push({ index: i, reason: `INVALID_SPAN_IDS: ${invalidSpans.join(",")}` });
      continue;
    }

    if (p.ontologyDisposition === "UNMAPPED_MATERIAL") {
      unmappedMaterialCount++;
    }

    if (p.polarity === "NEGATED") {
      negativeBoundaryCount++;
    }

    let subject: "ROLE" | "COMPANY" | "RECRUITING_PROCESS" = "ROLE";
    if (p.appliesTo === "COMPANY") subject = "COMPANY";
    else if (p.appliesTo === "RECRUITING_PROCESS") subject = "RECRUITING_PROCESS";
    else subject = "ROLE";

    const primaryUnit = unitMap.get(p.sourceEvidence[0])!;

    let effectiveTypes = [...p.canonicalTypes];
    if (p.appliesTo === "CANDIDATE_REQUIREMENT" && !effectiveTypes.includes("HARD_REQUIREMENT")) {
      effectiveTypes = effectiveTypes.filter(t => t !== "PNL_OWNERSHIP" && t !== "REVENUE_ACCOUNTABILITY");
      if (!effectiveTypes.includes("HARD_REQUIREMENT")) effectiveTypes.push("HARD_REQUIREMENT");
    } else if (p.appliesTo === "CANDIDATE_PREFERENCE" && !effectiveTypes.includes("PREFERRED_REQUIREMENT")) {
      effectiveTypes = effectiveTypes.filter(t => t !== "PNL_OWNERSHIP" && t !== "REVENUE_ACCOUNTABILITY");
      if (!effectiveTypes.includes("PREFERRED_REQUIREMENT")) effectiveTypes.push("PREFERRED_REQUIREMENT");
    }

    if (effectiveTypes.length === 0 && p.ontologyDisposition === "MAPPED") {
      rejectedPropositions.push({ index: i, reason: "MAPPED_DISPOSITION_WITHOUT_CANONICAL_TYPE" });
      continue;
    }

    for (const cType of effectiveTypes) {
      acceptedAtoms.push({
        propositionIndex: i,
        canonicalType: cType,
        subject,
        exactText: primaryUnit.exactText,
        startOffset: primaryUnit.startOffset,
        endOffset: primaryUnit.endOffset,
        spanId: primaryUnit.spanId,
        polarity: p.polarity,
        conditionDescription: p.conditionDescription ?? null,
        propositionText: p.proposition
      });
    }
  }

  return {
    acceptedAtoms,
    rejectedPropositions,
    unmappedMaterialCount,
    negativeBoundaryCount
  };
}
