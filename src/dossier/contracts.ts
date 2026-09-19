import { z } from "zod";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const planeSchema = z.enum(["JD", "CANDIDATE", "CONTEXT", "RELATIONAL"]);
export const sourceSchema = z.object({
  id: z.string().min(1),
  plane: z.enum(["JD", "CANDIDATE", "CONTEXT"]),
  title: z.string().min(1),
  locator: z.string().min(1),
  text: z.string().min(1),
  capturedAt: z.string().datetime(),
  publishedAt: z.string().optional(),
  // Explicit means present in this source, not independently verified as true.
  attribution: z.enum(["JOB_POST", "CANDIDATE_SUPPLIED", "COMPANY_PUBLISHED", "INDEPENDENT"]),
});
export type EvidenceSource = z.infer<typeof sourceSchema>;
export const citationSchema = z.object({ sourceId: z.string(), quote: z.string().min(1) });
export const claimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  state: z.enum(["EXPLICIT", "INFERRED"]),
  confidence: z.number().min(0).max(1),
  plane: planeSchema,
  citations: z.array(citationSchema),
  derivedFrom: z.array(z.string()),
  reasoning: z.string().optional(),
  validationQuestion: z.string().optional(),
});
export type Claim = z.infer<typeof claimSchema>;
export const operations = [
  "extract",
  "retrieve",
  "search",
  "correlate",
  "calculate",
  "derive",
  "infer",
  "validate",
  "ask",
] as const;
export const resolutionSchema = z.object({
  field: z.string().min(1),
  status: z.enum(["RESOLVED", "INFERRED", "OPEN"]),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]).nullable(),
  claimIds: z.array(z.string()),
  methods: z.array(z.enum(operations)).min(1),
  question: z.string().optional(),
  consequence: z.string().min(1),
});
export type FieldResolution = z.infer<typeof resolutionSchema>;
export const memoSections = [
  "executiveThesis",
  "opportunityValue",
  "mandate",
  "candidateFit",
  "decisionConditions",
  "approach",
] as const;
export const memoPointSchema = z
  .object({
    id: z.string().min(1),
    section: z.enum(memoSections),
    point: z.string().min(1),
    claimIds: z.array(z.string()).min(1),
    requirementIds: z.array(z.string()),
    resolutionFields: z.array(z.string()),
  })
  .strict();
export const narrativePlanSchema = z.object({
  roleArchetype: z.string().min(1),
  mandateShape: z.string().min(1),
  careerMove: z.string().min(1),
  authorityShape: z.string().min(1),
  fitShape: z.string().min(1),
  evidenceShape: z.string().min(1),
  decisionTension: z.string().min(1),
  companyTrajectory: z.string().min(1),
  argument: z.string().min(1),
  emphasis: z.array(z.string()).min(1),
  sectionOrder: z.array(z.string()).min(1),
  claimIds: z.array(z.string()).min(1),
  memoPoints: z.array(memoPointSchema).min(1).optional(),
});
export const candidateConflictSchema = z.object({
  topic: z.string().min(1),
  sourceIds: z.array(z.string()).min(2),
  question: z.string().min(1),
});
export const researchSchema = z.object({
  claims: z.array(claimSchema).min(1),
  resolutions: z.array(resolutionSchema).min(1),
  candidateConflicts: z.array(candidateConflictSchema),
  evaluation: z.object({
    verdict: z.enum(["PURSUE", "CONSIDER", "PASS"]),
    screeningViability: z.enum(["STRONG", "PLAUSIBLE", "FRAGILE", "BLOCKED"]),
    rationale: z.string().min(1),
    claimIds: z.array(z.string()).min(1),
    requirements: z
      .array(
        z.object({
          requirement: z.string(),
          mandatory: z.boolean(),
          decisionRole: z.enum(["HARD_SCREEN", "CORE_CAPABILITY", "ENABLER", "PREFERENCE"]),
          status: z.enum(["DIRECT", "ADJACENT", "TRANSFERABLE", "NOT_EVIDENCED", "CONTRADICTED"]),
          roleClaimIds: z.array(z.string()).min(1),
          candidateClaimIds: z.array(z.string()),
          reasoning: z.string(),
        }),
      )
      .min(1),
  }),
  narrativePlan: narrativePlanSchema,
});
export type Research = z.infer<typeof researchSchema>;

// Questions are a distinct speech act: an unresolved fact is never labelled explicit.
export const passageSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["CONCLUSION", "QUESTION", "ADVICE"]),
  state: z.enum(["EXPLICIT", "INFERRED"]),
  confidence: z.number().min(0).max(1),
  sourcePlane: planeSchema,
  evidenceRefs: z.array(z.string()).min(1),
  // Composition is advice. Require a concise derivation even for source-reported
  // observations so every evidence drill-down can explain why it matters.
  reasoning: z.string().min(1),
  validationQuestion: z.string().optional(),
});
export type Passage = z.infer<typeof passageSchema>;
// Child blocks may be empty only when no distinct decision value exists; renderers omit them.
const memoPassage = passageSchema.extend({
  text: z.string().min(1).max(600),
  reasoning: z.string().min(1).max(500),
});
const memoAdvice = memoPassage.extend({ kind: z.literal("ADVICE"), state: z.literal("INFERRED") });
const memoQuestion = memoPassage.extend({
  kind: z.literal("QUESTION"),
  state: z.literal("INFERRED"),
});
const memoInference = memoPassage.extend({
  kind: z.literal("CONCLUSION"),
  state: z.literal("INFERRED"),
});
export const compositionSchema = z.object({
  executiveThesis: memoInference.extend({ text: z.string().min(1).max(460) }),
  opportunityValue: z.array(memoPassage).min(1).max(3),
  mandate: z.object({
    priorities: z.array(memoPassage).min(1).max(3),
    outcomes: z.array(memoPassage).min(1).max(2),
  }),
  candidateFit: z
    .array(
      z
        .object({
          label: z.string().min(1).max(60),
          requirementIds: z.array(z.string()),
          assessment: memoPassage,
        })
        .strict(),
    )
    .min(1)
    .max(5),
  decisionConditions: z
    .array(
      z
        .object({
          requirementIds: z.array(z.string()),
          resolutionFields: z.array(z.string()),
          question: memoQuestion,
          consequence: memoInference,
        })
        .strict(),
    )
    .min(1)
    .max(5),
  approach: z.object({
    nextSteps: z.array(memoAdvice).min(1).max(2),
    opening: memoAdvice,
    resumeNarrative: z.array(memoAdvice).max(1),
    linkedinStrategy: z.array(memoAdvice).max(1),
    screening: z.array(memoAdvice).max(1),
    interview: z.array(memoAdvice).max(1),
  }),
});
export type Composition = z.infer<typeof compositionSchema>;
export const factualReviewReceiptSchema = z
  .object({
    section: z.string(),
    contentFingerprint: z.string().length(64),
    evidenceFingerprint: z.string().length(64),
    inputFingerprint: z.string().min(1),
    reviewer: z.string().min(1),
    policyVersion: z.string().min(1),
    passageIds: z.array(z.string()),
    accepted: z.literal(true),
    coveredPointIds: z.array(z.string()).optional(),
    planFingerprint: z.string().optional(),
  })
  .strict();
export type FactualReviewReceipt = z.infer<typeof factualReviewReceiptSchema>;
export interface Dossier extends Composition {
  opportunity: { id: string; company: string; title: string };
  candidate: { name: string };
  verdict: Research["evaluation"];
  narrativePlan: Research["narrativePlan"];
  resolutions: FieldResolution[];
  candidateConflicts: Research["candidateConflicts"];
  evidence: {
    roleClaims: Claim[];
    candidateClaims: Claim[];
    contextualClaims: Claim[];
    relationalClaims: Claim[];
    lineage: EvidenceSource[];
  };
  generatedAt: string;
  generation: {
    model: string;
    sourceFingerprint: string;
    factualReviewer?: { model: string; policyVersion: string };
    factualReviews?: FactualReviewReceipt[];
  };
  acquisition: AcquisitionAttempt[];
  /** Exact staged semantic trace. Presentation may explain it but never author it. */
  canonicalDecisionTrace?: JsonValue;
  /** Exact semantic output identity and its frozen-input lineage for staged dossiers. */
  sourceEvaluationFingerprint?: string;
  sourceInputFingerprint?: string;
}
export interface SliceInput {
  opportunity: Dossier["opportunity"];
  candidate: Dossier["candidate"];
  sources: EvidenceSource[];
}
export const dossierSchema = compositionSchema.extend({
  opportunity: z.object({ id: z.string(), company: z.string(), title: z.string() }),
  candidate: z.object({ name: z.string() }),
  verdict: researchSchema.shape.evaluation,
  narrativePlan: narrativePlanSchema,
  resolutions: z.array(resolutionSchema),
  candidateConflicts: z.array(candidateConflictSchema),
  evidence: z.object({
    roleClaims: z.array(claimSchema),
    candidateClaims: z.array(claimSchema),
    contextualClaims: z.array(claimSchema),
    relationalClaims: z.array(claimSchema),
    lineage: z.array(sourceSchema),
  }),
  generatedAt: z.string(),
  generation: z.object({
    model: z.string(),
    sourceFingerprint: z.string(),
    factualReviewer: z.object({ model: z.string(), policyVersion: z.string() }).optional(),
    factualReviews: z.array(factualReviewReceiptSchema).optional(),
  }),
  acquisition: z.array(
    z.object({
      provider: z.string(),
      field: z.string(),
      operation: z.enum(["retrieve", "search"]),
      status: z.enum(["ACQUIRED", "RETRIEVED", "NO_RESULTS", "UNAVAILABLE"]),
      sourceIds: z.array(z.string()),
      detail: z.string(),
    }),
  ),
  canonicalDecisionTrace: jsonValueSchema.optional(),
  sourceEvaluationFingerprint: z.string().optional(),
  sourceInputFingerprint: z.string().optional(),
});
export interface AcquisitionAttempt {
  provider: string;
  field: string;
  operation: "retrieve" | "search";
  status: "ACQUIRED" | "RETRIEVED" | "NO_RESULTS" | "UNAVAILABLE";
  sourceIds: string[];
  detail: string;
}
export const contextFields = [
  "companySize",
  "funding",
  "growth",
  "workforceTrajectory",
  "leadershipChanges",
  "relatedHiring",
  "marketExpansion",
  "organizationalStructure",
] as const;
export const scopeFields = [
  "reportingLine",
  "executiveDistance",
  "leadershipMode",
  "teamScale",
  "functionState",
  "geography",
  "commercialScope",
  "compensation",
] as const;

export interface ContextProvider {
  readonly id: string;
  acquire(
    opportunity: SliceInput["opportunity"],
    fields: readonly string[],
  ): Promise<{ sources: EvidenceSource[]; attempts: AcquisitionAttempt[] }>;
}
export interface ReasoningModel {
  readonly id: string;
  readonly version: string;
  readonly schemaFormat?: "openapi" | "json-schema";
  readonly configurationFingerprint?: string;
  generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
  ): Promise<unknown>;
  /** Discard an invalid transport/coverage response, never an accepted review. */
  discardResponse?(response: unknown): Promise<void>;
}
