/**
 * src/pursuit/types.ts
 *
 * The Pursuit Cockpit domain contract.
 *
 * Evaluation produces a recommendation. This module produces execution: given a
 * mandate worth pursuing and a candidate's verified evidence, what is the
 * sharpest way to argue for this person, in this role, to this audience.
 *
 * Three rules govern every type here:
 *   1. Source integrity. Metrics, employers, titles and dates are immutable
 *      facts carried with provenance. Only emphasis, ordering and framing are
 *      generated or editable.
 *   2. One anchor. Every artifact descends from a single PursuitThesis, so the
 *      resume, the outreach note and the interview brief cannot argue different
 *      things.
 *   3. Learning is about presentation. Candidate edits teach the system how this
 *      person wants to be written about, never what is true about them.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Evidence Ledger
// ---------------------------------------------------------------------------

export const claimProvenances = ["SOURCE_BACKED", "DERIVED", "TARGET_CONTEXT"] as const;
export type ClaimProvenance = (typeof claimProvenances)[number];

export const claimTypes = [
  "EMPLOYMENT",
  "ACHIEVEMENT",
  "LEADERSHIP",
  "TECHNOLOGY",
  "EDUCATION",
  "LOCATION",
  "OTHER",
] as const;
export type ClaimType = (typeof claimTypes)[number];

export interface CandidateClaim {
  id: string;
  statement: string;
  claimType: ClaimType;
  employer: string | null;
  roleTitle: string | null;
  metricBaseline: string | null;
  metricResult: string | null;
  capabilities: string[];
  sourceDocumentId: string | null;
  sourceEvidenceGraphId: string | null;
  sourceFactId: string | null;
  /** Exact span inside the source document. The hallucination barrier. */
  sourceLocator: string | null;
  provenance: ClaimProvenance;
  verificationState: string;
  confidence: number | null;
  /** When true, numbers inside the statement may not be altered by generation. */
  metricLocked: boolean;
  /** Position of the fact inside its source document; drives anchor-CV skeletons. */
  sourceOrdinal?: number | null;
}

// ---------------------------------------------------------------------------
// Positioning Archetypes
// ---------------------------------------------------------------------------

/**
 * An archetype is a strategic lens the candidate defines, not a file they
 * uploaded. "Automotive Focused" and "GCC Scope" can draw on the same verified
 * facts and still make different arguments.
 */
export interface CandidateArchetype {
  id: string;
  name: string;
  positioningStatement: string | null;
  emphasize: string[];
  deEmphasize: string[];
  targetRoles: string[];
  tone: string | null;
  pinnedClaimIds: string[];
  anchorDocumentIds: string[];
  isDefault: boolean;
  updatedAt: string;
}

export const archetypeInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(2).max(80),
  positioningStatement: z.string().max(600).optional(),
  emphasize: z.array(z.string().min(1).max(60)).max(12).default([]),
  deEmphasize: z.array(z.string().min(1).max(60)).max(12).default([]),
  targetRoles: z.array(z.string().min(1).max(80)).max(12).default([]),
  tone: z.string().max(60).optional(),
  pinnedClaimIds: z.array(z.string()).max(40).default([]),
  anchorDocumentIds: z.array(z.string()).max(20).default([]),
  isDefault: z.boolean().default(false),
});
export type ArchetypeInput = z.infer<typeof archetypeInputSchema>;

// ---------------------------------------------------------------------------
// Pursuit state
// ---------------------------------------------------------------------------

export const pursuitStatuses = [
  "PREPARING",
  "READY",
  "OUTREACH_SENT",
  "FIRST_CONVERSATION",
  "INTERVIEWING",
  "OFFER",
  "CLOSED_WON",
  "CLOSED_LOST",
  "WITHDRAWN",
] as const;
export type PursuitStatus = (typeof pursuitStatuses)[number];

export const activePursuitStatuses = [
  "PREPARING",
  "READY",
  "OUTREACH_SENT",
  "FIRST_CONVERSATION",
  "INTERVIEWING",
  "OFFER",
] as const satisfies readonly PursuitStatus[];

export const terminalPursuitStatuses = [
  "CLOSED_WON",
  "CLOSED_LOST",
  "WITHDRAWN",
] as const satisfies readonly PursuitStatus[];

export function isTerminalPursuitStatus(status: PursuitStatus): boolean {
  return terminalPursuitStatuses.includes(status as (typeof terminalPursuitStatuses)[number]);
}

export const pursuitStatusLabels: Record<PursuitStatus, string> = {
  PREPARING: "Preparing",
  READY: "Ready to send",
  OUTREACH_SENT: "Outreach sent",
  FIRST_CONVERSATION: "First conversation",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  CLOSED_WON: "Closed — won",
  CLOSED_LOST: "Closed — lost",
  WITHDRAWN: "Withdrawn",
};

export type PreparationState = "QUEUED" | "DERIVING" | "READY" | "FAILED";

export const PURSUIT_WORKER_UNAVAILABLE_MESSAGE =
  "Preparation service is currently unavailable. Your pursuit is saved and will continue when the worker is available.";

export function preparationServiceUnavailable(
  state: PreparationState,
  workerAvailable: boolean | null | undefined,
): boolean {
  return state === "QUEUED" && workerAvailable === false;
}

/** Canonical opportunity/evaluation lineage a pursuit or strategy version was derived from. */
export interface PursuitLineage {
  canonicalJobId: string | null;
  opportunityVersion: string | null;
  evaluationContextFingerprint: string | null;
  evaluationFingerprint: string | null;
  profileVersion: string | null;
}

export interface Pursuit {
  id: string;
  lineage?: PursuitLineage;
  jobHash: string;
  company: string | null;
  roleTitle: string | null;
  activeArchetypeId: string | null;
  activeThesisId: string | null;
  status: PursuitStatus;
  preparationState: PreparationState;
  preparationError: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pursuit Thesis — the single strategic anchor
// ---------------------------------------------------------------------------

export interface ProofPoint {
  /** Claim this proof point rests on. Empty only for TARGET_CONTEXT framing. */
  claimId: string | null;
  headline: string;
  whyItMatters: string;
  provenance: ClaimProvenance;
}

export interface Objection {
  objection: string;
  /** How the candidate answers it, grounded in the ledger. */
  counterPosition: string;
  supportingClaimIds: string[];
  severity: "MATERIAL" | "MODERATE" | "MINOR";
}

export type LensRelationship = "STRONG_DIRECT" | "SUPPORTING" | "LOW";

export interface ArchetypeScore {
  archetypeId: string;
  archetypeName: string;
  /** Internal ranking signal only. Never rendered. */
  score: number;
  reasoning: string;
  relationship?: LensRelationship;
  role?: "PRIMARY" | "SUPPORTING" | "LOW";
}

export interface OutreachRoute {
  route: string;
  stance: "PRIMARY" | "SECONDARY" | "AVOID";
  reasoning: string;
}

export interface PursuitThesis {
  id: string;
  pursuitId: string;
  version: number;
  archetypeId: string | null;
  /** What the organisation is actually buying, in one sentence. */
  targetMandate: string;
  /** Why talk to this candidate rather than another credible executive. */
  winTheme: string;
  recommendedPositioning: string;
  primaryProof: ProofPoint[];
  objections: Objection[];
  narrativesToAvoid: string[];
  targetAudience: string[];
  archetypeScores: ArchetypeScore[];
  archetypeMatchReasoning: string | null;
  routeStrategy: OutreachRoute[];
  derivation: "MODEL" | "DETERMINISTIC";
  modelId: string | null;
  /** Reasoning inputs and interpretation this version was derived from. */
  semantic?: import("./semantic/types").SemanticSnapshot | null;
  lineage?: PursuitLineage & { ledgerBindingFingerprint: string | null; anchorDocumentId: string | null };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const artifactTypes = [
  "RESUME",
  "EXEC_NOTE",
  "WARM_INTRO",
  "RECRUITER_BRIEF",
  "APPLICATION_STATEMENT",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
  "INTERVIEW_BRIEF",
] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export const artifactLabels: Record<ArtifactType, string> = {
  RESUME: "Tailored Resume",
  EXEC_NOTE: "Executive Direct Note",
  WARM_INTRO: "Warm Introduction Request",
  RECRUITER_BRIEF: "Search Consultant Brief",
  APPLICATION_STATEMENT: "Application Portal Statement",
  FOLLOW_UP_1: "Follow-up — Day 5",
  FOLLOW_UP_2: "Follow-up — Day 12",
  INTERVIEW_BRIEF: "Interview & Conversation Brief",
};

export type ArtifactStatus = "DRAFT" | "USER_CUSTOMIZED" | "APPROVED";

export const resumeTemplateIds = ["EXECUTIVE_BRIEF", "EDITORIAL", "ATS_PLAIN"] as const;
export type ResumeTemplateId = (typeof resumeTemplateIds)[number];

export const resumeTemplates: Array<{ id: ResumeTemplateId; label: string; description: string }> = [
  { id: "EXECUTIVE_BRIEF", label: "Executive Brief", description: "Structured executive presentation with strong metric emphasis." },
  { id: "EDITORIAL", label: "Editorial", description: "Quieter, narrative-led presentation for senior leadership roles." },
  { id: "ATS_PLAIN", label: "ATS Plain", description: "Minimal formatting for application portals and parsing." },
];

export interface ResumeMetric {
  value: string;
  caption: string;
  claimId: string | null;
}

export interface ResumeExportOptions {
  resumeTemplate?: ResumeTemplateId;
  metricGrid?: boolean;
}

export interface ResumeBullet {
  claimId: string | null;
  text: string;
  /** Set when the candidate changed the verified wording. */
  edited: boolean;
  /** Set when an edit dropped a number the source claim had locked. */
  metricDrift?: boolean;
  provenance: ClaimProvenance;
}

export interface ResumeRole {
  employer: string;
  roleTitle: string;
  period: string | null;
  bullets: ResumeBullet[];
}

export interface ResumeContent {
  fullName: string;
  contactLine: string;
  headline: string;
  executiveSummary: string;
  /** The three arguments that carry this specific application. */
  impactAnchors: ResumeBullet[];
  roles: ResumeRole[];
  capabilities: string[];
  /** Source-backed figures selected for template presentation. */
  metricHighlights?: ResumeMetric[];
  /** Source CV whose structure this resume was transformed from; null = assembled from the ledger. */
  anchorDocumentId?: string | null;
}

export interface MessageContent {
  subject: string | null;
  body: string;
  /** Word budget the module was written to; shown so the user can keep it tight. */
  targetWords: number | null;
  /** Exact message spans and the candidate claims licensing those assertions. */
  proofAssertions?: Array<{ text: string; claimIds: string[] }>;
}

export interface ProofStory {
  /** READY stories contain no placeholders; INCOMPLETE ones list what is missing. */
  status?: "READY" | "INCOMPLETE";
  knownFacts?: string[];
  missingFields?: string[];
  title: string;
  challenge: string;
  action: string;
  scale: string;
  result: string;
  relevance: string;
  claimIds: string[];
}

export interface InterviewBriefContent {
  mandateSentence: string;
  proofStories: ProofStory[];
  questionsToAsk: string[];
  firstNinetyDays: string[];
  risksToAddress: string[];
}

export type ArtifactContent =
  | { kind: "RESUME"; resume: ResumeContent }
  | { kind: "MESSAGE"; message: MessageContent }
  | { kind: "INTERVIEW_BRIEF"; brief: InterviewBriefContent };

// ---------------------------------------------------------------------------
// Artifact content validation
//
// The save endpoint must not accept an arbitrary blob: a malformed artifact
// cannot be allowed to reach APPROVED and then be exported. These schemas are
// the server-side shape contract for every persisted artifact.
// ---------------------------------------------------------------------------

const provenanceSchema = z.enum(["SOURCE_BACKED", "DERIVED", "TARGET_CONTEXT"]);

const bulletSchema = z.object({
  claimId: z.string().min(1).nullable(),
  text: z.string().min(1).max(1200),
  edited: z.boolean(),
  metricDrift: z.boolean().optional(),
  provenance: provenanceSchema,
});

const resumeSchema = z.object({
  fullName: z.string().min(1).max(200),
  contactLine: z.string().max(400),
  headline: z.string().max(400),
  executiveSummary: z.string().max(4000),
  impactAnchors: z.array(bulletSchema).max(12),
  roles: z
    .array(
      z.object({
        employer: z.string().min(1).max(200),
        roleTitle: z.string().min(1).max(200),
        period: z.string().max(80).nullable(),
        bullets: z.array(bulletSchema).max(24),
      }),
    )
    .max(20),
  capabilities: z.array(z.string().max(160)).max(40),
  metricHighlights: z.array(z.object({
    value: z.string().min(1).max(80),
    caption: z.string().min(1).max(180),
    claimId: z.string().min(1).nullable(),
  })).max(8).optional(),
  anchorDocumentId: z.string().min(1).nullable().optional(),
});

const messageSchema = z.object({
  subject: z.string().max(300).nullable(),
  body: z.string().min(1).max(12000),
  targetWords: z.number().int().positive().max(2000).nullable(),
  proofAssertions: z.array(z.object({
    text: z.string().min(1).max(1200),
    claimIds: z.array(z.string().min(1)).min(1).max(8),
  })).max(20).optional(),
});

const proofStorySchema = z.object({
  status: z.enum(["READY", "INCOMPLETE"]).optional(),
  knownFacts: z.array(z.string().max(600)).max(20).optional(),
  missingFields: z.array(z.string().max(300)).max(20).optional(),
  title: z.string().max(300),
  challenge: z.string().max(3000),
  action: z.string().max(3000),
  scale: z.string().max(1200),
  result: z.string().max(3000),
  relevance: z.string().max(3000),
  claimIds: z.array(z.string().min(1)).max(20),
});

const interviewBriefSchema = z.object({
  mandateSentence: z.string().max(2000),
  proofStories: z.array(proofStorySchema).max(20),
  questionsToAsk: z.array(z.string().max(600)).max(30),
  firstNinetyDays: z.array(z.string().max(800)).max(30),
  risksToAddress: z.array(z.string().max(800)).max(30),
});

export const artifactContentSchema: z.ZodType<ArtifactContent> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RESUME"), resume: resumeSchema }),
  z.object({ kind: z.literal("MESSAGE"), message: messageSchema }),
  z.object({ kind: z.literal("INTERVIEW_BRIEF"), brief: interviewBriefSchema }),
]) as z.ZodType<ArtifactContent>;

/**
 * Approval is a stronger gate than a draft save: an APPROVED artifact is what
 * leaves the system, so it must be substantively complete, not merely shaped.
 * Returns the blocking reasons; an empty array means approval is permitted.
 */
export function approvalBlockers(content: ArtifactContent): string[] {
  const blockers: string[] = [];
  if (content.kind === "RESUME") {
    const r = content.resume;
    if (r.executiveSummary.trim().length < 40) blockers.push("Executive summary is too thin to send.");
    if (r.impactAnchors.length === 0) blockers.push("No impact anchors selected.");
    if (r.roles.length === 0) blockers.push("No roles present.");
    const placeholder = /\[[^\]]*\]|\bTBD\b|\bXX\b|\{\{/;
    const all = [...r.impactAnchors, ...r.roles.flatMap((x) => x.bullets)];
    if (all.some((b) => placeholder.test(b.text)))
      blockers.push("Some bullets still contain unresolved placeholders.");
    if (r.impactAnchors.some((b) => b.provenance === "TARGET_CONTEXT"))
      blockers.push("An impact anchor rests on target-role context rather than your own evidence.");
    const skeletal = all.filter((b) => b.text.trim().split(/\s+/).length < 7);
    if (all.length >= 3 && skeletal.length > all.length / 2)
      blockers.push("Most résumé bullets are too brief to present as complete achievements.");
  }
  if (content.kind === "MESSAGE") {
    const body = content.message.body.trim();
    if (body.length < 80) blockers.push("Message body is too short to send.");
    if (/\[[^\]]*\]|\bTBD\b|\{\{/.test(body))
      blockers.push("Message still contains unresolved placeholders.");
  }
  if (content.kind === "INTERVIEW_BRIEF") {
    const b = content.brief;
    if (b.proofStories.length === 0) blockers.push("No proof stories prepared.");
    if (b.proofStories.every((s) => s.status === "INCOMPLETE"))
      blockers.push("Every proof story is still incomplete.");
    if (b.mandateSentence.trim().length < 20) blockers.push("Mandate sentence is missing.");
  }
  return blockers;
}

export interface PursuitArtifact {
  id: string;
  pursuitId: string;
  thesisId: string | null;
  artifactType: ArtifactType;
  version: number;
  content: ArtifactContent;
  renderedText: string | null;
  status: ArtifactStatus;
  provenanceFlags: string[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Activities & learning
// ---------------------------------------------------------------------------

export interface PursuitActivity {
  id: string;
  activityType: string;
  channel: string | null;
  counterparty: string | null;
  summary: string;
  occurredAt: string;
}

export const learningSignalTypes = [
  "PROOF_SWAPPED",
  "BULLET_PROMOTED",
  "BULLET_DEMOTED",
  "BULLET_REJECTED",
  "PHRASE_REWRITTEN",
  "ARCHETYPE_OVERRIDDEN",
  "SUMMARY_REWRITTEN",
  "MESSAGE_REWRITTEN",
] as const;
export type LearningSignalType = (typeof learningSignalTypes)[number];

export interface LearningSignal {
  signalType: LearningSignalType;
  subject: string | null;
  originalValue: string | null;
  newValue: string | null;
}

/**
 * The bounded style profile injected into later generations. It carries
 * presentation preference only — it can never introduce or alter a fact.
 */
export interface StyleProfile {
  preferredPhrasings: Array<{ from: string; to: string }>;
  promotedClaimIds: string[];
  rejectedClaimIds: string[];
  archetypeOverrides: Array<{ from: string; to: string }>;
  observedEditCount: number;
}

// ---------------------------------------------------------------------------
// Cockpit read model
// ---------------------------------------------------------------------------

export interface CockpitView {
  /** Server-verified scope this cockpit belongs to. Never supplied by the client. */
  scope: { tenantId: string; personId: string };
  pursuit: Pursuit;
  thesis: PursuitThesis | null;
  thesisHistory: Array<{ id: string; version: number; createdAt: string; winTheme: string }>;
  artifacts: PursuitArtifact[];
  archetypes: CandidateArchetype[];
  claims: CandidateClaim[];
  activities: PursuitActivity[];
  ledgerCoverage: { total: number; sourceBacked: number; documents: number };
  /** Latest durable preparation job for this pursuit, if any. */
  preparation?: { status: string; attempts: number; lastError: string | null; createdAt: string } | null;
  /** Release- and database-matched Pursuit worker liveness when preparation is queued. */
  workerAvailable?: boolean | null;
}
