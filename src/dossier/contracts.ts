import { z } from 'zod';

export const planeSchema = z.enum(['JD', 'CANDIDATE', 'CONTEXT', 'RELATIONAL']);
export const sourceSchema = z.object({
  id: z.string().min(1), plane: z.enum(['JD', 'CANDIDATE', 'CONTEXT']),
  title: z.string().min(1), locator: z.string().min(1), text: z.string().min(1),
  capturedAt: z.string().datetime(), publishedAt: z.string().optional(),
  // Explicit means present in this source, not independently verified as true.
  attribution: z.enum(['JOB_POST', 'CANDIDATE_SUPPLIED', 'COMPANY_PUBLISHED', 'INDEPENDENT']),
});
export type EvidenceSource = z.infer<typeof sourceSchema>;
export const citationSchema = z.object({ sourceId: z.string(), quote: z.string().min(1) });
export const claimSchema = z.object({
  id: z.string().min(1), text: z.string().min(1),
  state: z.enum(['EXPLICIT', 'INFERRED']), confidence: z.number().min(0).max(1),
  plane: planeSchema, citations: z.array(citationSchema),
  derivedFrom: z.array(z.string()), reasoning: z.string().optional(),
  validationQuestion: z.string().optional(),
});
export type Claim = z.infer<typeof claimSchema>;
export const operations = ['extract', 'retrieve', 'search', 'correlate', 'calculate', 'derive', 'infer', 'validate', 'ask'] as const;
export const resolutionSchema = z.object({
  field: z.string().min(1), status: z.enum(['RESOLVED', 'INFERRED', 'OPEN']),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]).nullable(),
  claimIds: z.array(z.string()), methods: z.array(z.enum(operations)).min(1),
  question: z.string().optional(), consequence: z.string().min(1),
});
export type FieldResolution = z.infer<typeof resolutionSchema>;
export const narrativePlanSchema = z.object({
  roleArchetype: z.string().min(1), mandateShape: z.string().min(1),
  careerMove: z.string().min(1), authorityShape: z.string().min(1),
  fitShape: z.string().min(1), evidenceShape: z.string().min(1),
  decisionTension: z.string().min(1), companyTrajectory: z.string().min(1),
  argument: z.string().min(1), emphasis: z.array(z.string()).min(1),
  sectionOrder: z.array(z.string()).min(1), claimIds: z.array(z.string()).min(1),
});
export const candidateConflictSchema = z.object({
  topic: z.string().min(1), sourceIds: z.array(z.string()).min(2), question: z.string().min(1),
});
export const researchSchema = z.object({
  claims: z.array(claimSchema).min(1), resolutions: z.array(resolutionSchema).min(1),
  candidateConflicts: z.array(candidateConflictSchema),
  evaluation: z.object({ verdict: z.enum(['PURSUE', 'CONSIDER', 'PASS']), rationale: z.string().min(1), claimIds: z.array(z.string()).min(1),
    requirements: z.array(z.object({ requirement: z.string(), mandatory: z.boolean(), status: z.enum(['SUPPORTED', 'TRANSFERABLE', 'NOT_EVIDENCED', 'CONTRADICTED']), roleClaimIds: z.array(z.string()).min(1), candidateClaimIds: z.array(z.string()), reasoning: z.string() })).min(1),
  }),
  narrativePlan: narrativePlanSchema,
});
export type Research = z.infer<typeof researchSchema>;

// Questions are a distinct speech act: an unresolved fact is never labelled explicit.
export const passageSchema = z.object({
  text: z.string().min(1), kind: z.enum(['CONCLUSION', 'QUESTION', 'ADVICE']),
  state: z.enum(['EXPLICIT', 'INFERRED']), confidence: z.number().min(0).max(1),
  sourcePlane: planeSchema, evidenceRefs: z.array(z.string()).min(1),
  // Composition is advice. Require a concise derivation even for source-reported
  // observations so every evidence drill-down can explain why it matters.
  reasoning: z.string().min(1), validationQuestion: z.string().optional(),
});
export type Passage = z.infer<typeof passageSchema>;
const passages = z.array(passageSchema).min(1);
export const compositionSchema = z.object({
  executiveThesis: passageSchema, roleInterest: passages, strategicValue: passages,
  recommendation: z.object({ identityAlignment: passages, capabilityCoverage: passages, careerCapital: passages }),
  // A fit category may have no demonstrated precedent. The gaps section explains why.
  fit: z.object({ direct: z.array(passageSchema), adjacent: z.array(passageSchema), transferable: z.array(passageSchema), gaps: passages }),
  mandate: z.object({ immediate: passages, nearTerm: passages, mediumTerm: passages, outcomes: passages }),
  successRequirements: passages,
  candidatePositioning: z.object({ precedents: passages, differentiators: passages, evidence: passages }),
  openQuestions: passages, watchPoints: passages,
  decisionHinges: z.object({ strongerPursueIf: passages, weakerIf: passages, passIf: passages }),
  conversationStrategy: z.object({ approach: passages, opening: passages, questions: passages, positioning: passages, screening: passages, interview: passages, resumeNarrative: passages, linkedinStrategy: passages }),
});
export type Composition = z.infer<typeof compositionSchema>;
export interface Dossier extends Composition {
  opportunity: { id: string; company: string; title: string };
  candidate: { name: string };
  verdict: Research['evaluation'];
  narrativePlan: Research['narrativePlan'];
  resolutions: FieldResolution[];
  candidateConflicts: Research['candidateConflicts'];
  evidence: { roleClaims: Claim[]; candidateClaims: Claim[]; contextualClaims: Claim[]; relationalClaims: Claim[]; lineage: EvidenceSource[] };
  generatedAt: string;
  generation: { model: string; sourceFingerprint: string };
  acquisition: AcquisitionAttempt[];
}
export interface SliceInput {
  opportunity: Dossier['opportunity']; candidate: Dossier['candidate']; sources: EvidenceSource[];
}
export interface AcquisitionAttempt {
  provider: string; field: string; operation: 'retrieve' | 'search';
  status: 'ACQUIRED' | 'UNAVAILABLE'; sourceIds: string[]; detail: string;
}
export const contextFields = ['companySize', 'funding', 'growth', 'workforceTrajectory', 'leadershipChanges', 'relatedHiring', 'marketExpansion', 'organizationalStructure'] as const;
export const scopeFields = ['reportingLine', 'executiveDistance', 'leadershipMode', 'teamScale', 'functionState', 'geography', 'commercialScope', 'compensation'] as const;

export interface ContextProvider {
  readonly id: string;
  acquire(opportunity: SliceInput['opportunity'], fields: readonly string[]): Promise<{ sources: EvidenceSource[]; attempts: AcquisitionAttempt[] }>;
}
export interface ReasoningModel {
  readonly id: string; readonly version: string;
  generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown>;
}
