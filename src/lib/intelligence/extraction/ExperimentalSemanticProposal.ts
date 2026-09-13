/**
 * Batch 03 experimental boundary: models propose semantics and exact quotes;
 * RADAR alone resolves source anchors and constructs the V1 representation.
 * This module deliberately does not invoke either deterministic semantic
 * extractor. Its limited document parsing is structural only.
 */
import type {
  CandidateEvidenceClass,
  CandidatePosition,
  CandidateProofClaim,
  CandidateProofOutputV1,
  CandidateProofType,
  CandidateSourceBullet,
} from "./CandidateProofExtractorV1";
import { CandidateProofExtractorV1 } from "./CandidateProofExtractorV1";
import type {
  RoleIntelligenceOutputV1,
  DetectedSection,
  RolePropositionAtom,
  RoleSemanticType,
  RoleSubject,
  SectionType,
} from "./RoleIntelligenceExtractorV1";

export const LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION = "semantic-proposal/v1";
export const LLM_SEMANTIC_ASSEMBLER_VERSION = "semantic-assembler/v2";

export interface RoleSemanticProposal {
  readonly exactQuote: string;
  readonly semanticType?: RoleSemanticType;
  readonly subject: RoleSubject;
  readonly confidence: number;
}

export interface CandidateSemanticProposal {
  readonly exactQuote: string;
  readonly evidenceClass: CandidateEvidenceClass;
  readonly proofTypes: readonly CandidateProofType[];
}

const ROLE_TYPES = [
  "ROLE_PURPOSE", "RESPONSIBILITY", "OUTCOME", "SUCCESS_METRIC",
  "HARD_REQUIREMENT", "PREFERRED_REQUIREMENT", "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY", "BOARD_EXPOSURE", "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY", "PROFITABILITY_ACCOUNTABILITY", "BUDGET_SCOPE",
  "DECISION_AUTHORITY", "PEOPLE_LEADERSHIP", "PEOPLE_SCALE", "GREENFIELD_BUILD",
  "TRANSFORMATION", "GEOGRAPHIC_SCOPE", "REGULATORY_SCOPE", "PRODUCT_SCOPE",
  "CUSTOMER_SCOPE", "CHANNEL_SCOPE", "COMPANY_CONTEXT", "WORK_CONDITION",
] as const satisfies readonly RoleSemanticType[];
const ROLE_SUBJECTS = ["ROLE", "COMPANY", "RECRUITING_PROCESS"] as const satisfies readonly RoleSubject[];
const EVIDENCE_CLASSES = ["WORK_HISTORY", "SELF_SUMMARY", "CAPABILITY_LABEL"] as const satisfies readonly CandidateEvidenceClass[];
const PROOF_TYPES = [
  "OUTCOME", "OWNERSHIP", "FINANCIAL_SCOPE", "PEOPLE_SCOPE", "GEOGRAPHIC_SCOPE",
  "ORGANIZATION_BUILD", "TRANSFORMATION", "MANDATE", "PRODUCT_LAUNCH",
  "CUSTOMER_GROWTH", "REVENUE_GROWTH", "COST_EFFICIENCY", "PIPELINE_GENERATION",
  "TECHNOLOGY_IMPLEMENTATION", "PARTNERSHIP", "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT", "CAPABILITY_LABEL",
] as const satisfies readonly CandidateProofType[];

const roleTypeSet = new Set<string>(ROLE_TYPES);
const roleSubjectSet = new Set<string>(ROLE_SUBJECTS);
const evidenceClassSet = new Set<string>(EVIDENCE_CLASSES);
const proofTypeSet = new Set<string>(PROOF_TYPES);

export const ROLE_SEMANTIC_PROPOSAL_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["proposals"],
  properties: { proposals: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["exactQuote", "subject", "confidence"], properties: {
      exactQuote: { type: "string", minLength: 1 }, semanticType: { enum: ROLE_TYPES },
      subject: { enum: ROLE_SUBJECTS }, confidence: { type: "number", minimum: 0, maximum: 1 },
    } } } },
} as const;

export const CANDIDATE_SEMANTIC_PROPOSAL_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["proposals"],
  properties: { proposals: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["exactQuote", "evidenceClass", "proofTypes"], properties: {
      exactQuote: { type: "string", minLength: 1 }, evidenceClass: { enum: EVIDENCE_CLASSES },
      proofTypes: { type: "array", minItems: 1, uniqueItems: true, items: { enum: PROOF_TYPES } },
    } } } },
} as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains a non-semantic field.`);
}

function parseRoot(value: unknown, label: string): unknown[] {
  const root = asRecord(value, `${label} envelope`);
  assertOnlyKeys(root, ["proposals"], `${label} envelope`);
  if (!Array.isArray(root.proposals)) throw new Error(`${label} proposals must be an array.`);
  return root.proposals;
}

export function parseRoleSemanticProposals(value: unknown): RoleSemanticProposal[] {
  return parseRoot(value, "role").map((item) => {
    const proposal = asRecord(item, "role proposal");
    assertOnlyKeys(proposal, ["exactQuote", "semanticType", "subject", "confidence"], "role proposal");
    if (typeof proposal.exactQuote !== "string" || proposal.exactQuote.length === 0
      || !roleSubjectSet.has(String(proposal.subject))
      || typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence)
      || proposal.confidence < 0 || proposal.confidence > 1
      || (proposal.semanticType !== undefined && !roleTypeSet.has(String(proposal.semanticType)))) {
      throw new Error("Malformed role semantic proposal.");
    }
    return { exactQuote: proposal.exactQuote, semanticType: proposal.semanticType as RoleSemanticType | undefined,
      subject: proposal.subject as RoleSubject, confidence: proposal.confidence };
  });
}

export function parseCandidateSemanticProposals(value: unknown): CandidateSemanticProposal[] {
  return parseRoot(value, "candidate").map((item) => {
    const proposal = asRecord(item, "candidate proposal");
    assertOnlyKeys(proposal, ["exactQuote", "evidenceClass", "proofTypes"], "candidate proposal");
    if (typeof proposal.exactQuote !== "string" || proposal.exactQuote.length === 0
      || !evidenceClassSet.has(String(proposal.evidenceClass))
      || !Array.isArray(proposal.proofTypes) || proposal.proofTypes.length === 0
      || proposal.proofTypes.some((type) => !proofTypeSet.has(String(type)))
      || new Set(proposal.proofTypes).size !== proposal.proofTypes.length) {
      throw new Error("Malformed candidate semantic proposal.");
    }
    return { exactQuote: proposal.exactQuote, evidenceClass: proposal.evidenceClass as CandidateEvidenceClass,
      proofTypes: proposal.proofTypes as CandidateProofType[] };
  });
}

interface ResolvedQuote { readonly startOffset: number; readonly endOffset: number; }

export type SemanticProposalRejectionCode =
  | "ABSENT_QUOTE"
  | "AMBIGUOUS_QUOTE"
  | "DUPLICATE_SEMANTIC_ANCHOR"
  | "STRUCTURAL_CONTAINMENT";

export interface SemanticProposalRejection {
  readonly proposalIndex: number;
  readonly exactQuote: string;
  readonly code: SemanticProposalRejectionCode;
}

class ExpectedProposalRejection extends Error {
  constructor(readonly code: Exclude<SemanticProposalRejectionCode, "DUPLICATE_SEMANTIC_ANCHOR">) {
    super(code);
  }
}

export interface SemanticAssemblyResult<T> {
  readonly output: T;
  readonly proposalRejections: readonly SemanticProposalRejection[];
}

/** Exact only: no whitespace repair, fuzzy match, or arbitrary first occurrence. */
function resolveUniqueQuote(text: string, exactQuote: string): ResolvedQuote {
  const startOffset = text.indexOf(exactQuote);
  if (startOffset < 0) throw new ExpectedProposalRejection("ABSENT_QUOTE");
  if (text.indexOf(exactQuote, startOffset + 1) >= 0) throw new ExpectedProposalRejection("AMBIGUOUS_QUOTE");
  return { startOffset, endOffset: startOffset + exactQuote.length };
}

interface AcceptedProposal<T> { readonly proposal: T; readonly proposalIndex: number; readonly anchor: ResolvedQuote; }

/**
 * A syntactically valid envelope may include individually bad semantic
 * proposals. Preserve valid, independently source-bound proposals; count the
 * rest as rejected. A malformed envelope remains a whole-response rejection.
 */
function resolveProposals<T extends { exactQuote: string }>(
  text: string,
  proposals: readonly T[],
  duplicateIdentity: (proposal: T, anchor: ResolvedQuote) => string,
): { readonly accepted: readonly AcceptedProposal<T>[]; readonly rejections: readonly SemanticProposalRejection[] } {
  const candidates: Array<AcceptedProposal<T>> = [];
  const rejections: SemanticProposalRejection[] = [];
  for (const [proposalIndex, proposal] of proposals.entries()) {
    try {
      candidates.push({ proposal, proposalIndex, anchor: resolveUniqueQuote(text, proposal.exactQuote) });
    } catch (error) {
      if (!(error instanceof ExpectedProposalRejection)) throw error;
      rejections.push({ proposalIndex, exactQuote: proposal.exactQuote, code: error.code });
    }
  }
  const byAnchor = new Map<string, Array<AcceptedProposal<T>>>();
  for (const candidate of candidates) {
    const key = duplicateIdentity(candidate.proposal, candidate.anchor);
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), candidate]);
  }
  const accepted: AcceptedProposal<T>[] = [];
  for (const group of byAnchor.values()) {
    if (group.length === 1) accepted.push(group[0]!);
    else for (const candidate of group) rejections.push({
      proposalIndex: candidate.proposalIndex,
      exactQuote: candidate.proposal.exactQuote,
      code: "DUPLICATE_SEMANTIC_ANCHOR",
    });
  }
  return { accepted, rejections };
}

function canonicalProofTypes(proofTypes: readonly CandidateProofType[]): CandidateProofType[] {
  return [...proofTypes].sort((left, right) => PROOF_TYPES.indexOf(left) - PROOF_TYPES.indexOf(right));
}

/** Heading-only structural parsing; it never invokes a semantic extractor. */
function roleSectionType(heading: string): SectionType {
  if (/responsibilit|what you.?ll do|what you will do/.test(heading)) return "RESPONSIBILITIES";
  if (/requirement|qualification|what you bring/.test(heading)) return "REQUIREMENTS";
  if (/about|company/.test(heading)) return "ABOUT_COMPANY";
  if (/benefit|perks/.test(heading)) return "BENEFITS";
  return "OTHER";
}

function parseRoleSections(text: string): DetectedSection[] {
  const headings = [...text.matchAll(/(?:^|\n)(\s*#{1,4}\s+[^\n]+)/g)].map((match) => {
    const headingText = match[1]!.trim();
    const headingStart = (match.index ?? 0) + match[0].indexOf(headingText);
    return { headingText, headingStart, headingEnd: headingStart + headingText.length };
  });
  return headings.map((heading, index) => {
    const contentStart = heading.headingEnd;
    const contentEnd = headings[index + 1]?.headingStart ?? text.length;
    return {
      type: roleSectionType(heading.headingText.replace(/^\s*#*\s*/, "").toLowerCase()),
      headingText: heading.headingText,
      headingStart: heading.headingStart,
      headingEnd: heading.headingEnd,
      contentStart,
      contentEnd,
      rawContent: text.slice(contentStart, contentEnd),
    };
  });
}

function structuralRoleSection(sections: readonly DetectedSection[], quote: ResolvedQuote): SectionType {
  const section = sections.find((candidate) => quote.startOffset >= candidate.contentStart && quote.endOffset <= candidate.contentEnd);
  return section?.type ?? "OTHER";
}

export function assembleRoleSemanticProposals(input: {
  readonly sourceText: string; readonly caseId: string; readonly canonicalJobId: string;
  readonly companyName?: string; readonly title?: string; readonly proposals: readonly RoleSemanticProposal[];
}): SemanticAssemblyResult<RoleIntelligenceOutputV1> {
  const resolution = resolveProposals(
    input.sourceText,
    input.proposals,
    (proposal, anchor) => `${anchor.startOffset}:${anchor.endOffset}:${proposal.semanticType ?? "UNCLASSIFIED"}`,
  );
  const sections = parseRoleSections(input.sourceText);
  const atoms: RolePropositionAtom[] = resolution.accepted.map(({ proposal, anchor }) => {
    const semanticType = proposal.semanticType;
    return {
      id: `role_atom:${input.caseId}:${anchor.startOffset}_${anchor.endOffset}:${semanticType ?? "UNCLASSIFIED"}`,
      exactText: proposal.exactQuote, startOffset: anchor.startOffset, endOffset: anchor.endOffset,
      section: structuralRoleSection(sections, anchor), subject: proposal.subject, semanticType,
      confidence: proposal.confidence, extractionMethod: "SEMANTIC_FALLBACK", epistemicMarker: "EXACT_SOURCE_STATEMENT",
    };
  });
  const output: RoleIntelligenceOutputV1 = {
    caseId: input.caseId, canonicalJobId: input.canonicalJobId,
    ...(input.companyName === undefined ? {} : { companyName: input.companyName }),
    ...(input.title === undefined ? {} : { title: input.title }),
    rawTextLength: input.sourceText.length, sections, atoms,
    metadata: { extractorVersion: "RoleIntelligenceExtractorV1", hasGluedHeadings: false, hasStructuralMetaLines: false,
      proposalCounts: { proposedAtoms: input.proposals.length, acceptedAtoms: atoms.length, rejectedAtoms: resolution.rejections.length } },
  };
  return { output, proposalRejections: resolution.rejections };
}

interface StructuralPosition {
  readonly positionId: string; readonly title: string; readonly employer: string; readonly dates: string;
  readonly startOffset: number; readonly endOffset: number; readonly isCurrent: boolean;
}

function parseCandidatePositions(text: string): StructuralPosition[] {
  const headers = [...text.matchAll(/(?:^|\n)#{3,4}\s*([^\n]+)/g)]
    .map((match) => ({ index: (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0), line: match[1]!.trim() }))
    .filter((item) => item.line.includes("|"));
  return headers.map((header, index) => {
    const parts = header.line.split("|").map((part) => part.replace(/\*{2}|__/g, "").trim());
    const employer = parts[1]!;
    const dates = parts[2] ?? "";
    return { positionId: `pos:${employer.replace(/\s+/g, "_")}:${header.index}`, title: parts[0]!, employer, dates,
      startOffset: header.index, endOffset: headers[index + 1]?.index ?? text.length, isCurrent: /present/i.test(dates) };
  });
}

function parseBullets(text: string, position: StructuralPosition, sourceDocumentId: string): CandidateSourceBullet[] {
  const block = text.slice(position.startOffset, position.endOffset);
  const bullets: CandidateSourceBullet[] = [];
  for (const match of block.matchAll(/(?:^|\n)\s*[-*•]\s+([^\n]+(?:\n(?!\s*[-*•]|\s*#{2,4})[^\n]+)*)/g)) {
    const exactText = match[1]!.trim();
    const startOffset = position.startOffset + (match.index ?? 0) + match[0].indexOf(exactText);
    const endOffset = startOffset + exactText.length;
    bullets.push({ bulletId: `bullet:pos:${sourceDocumentId}:${position.employer.replace(/\s+/g, "_")}:${startOffset}_${endOffset}`,
      exactText, startOffset, endOffset, claims: [] });
  }
  return bullets;
}

function parentForCandidateProposal(proposal: CandidateSemanticProposal, anchor: ResolvedQuote,
  positions: readonly StructuralPosition[], bullets: readonly CandidateSourceBullet[]) {
  const bullet = bullets.find((candidate) => anchor.startOffset >= candidate.startOffset && anchor.endOffset <= candidate.endOffset);
  const position = positions.find((candidate) => anchor.startOffset >= candidate.startOffset && anchor.endOffset <= candidate.endOffset);
  if (proposal.evidenceClass === "WORK_HISTORY" && (!bullet || !position)) {
    throw new ExpectedProposalRejection("STRUCTURAL_CONTAINMENT");
  }
  return bullet ? { bullet, position, parentText: bullet.exactText, parentStart: bullet.startOffset, parentEnd: bullet.endOffset }
    : { parentText: proposal.exactQuote, parentStart: anchor.startOffset, parentEnd: anchor.endOffset };
}

export function assembleCandidateSemanticProposals(input: {
  readonly sourceText: string; readonly sourceDocumentId: string; readonly proposals: readonly CandidateSemanticProposal[];
}): SemanticAssemblyResult<CandidateProofOutputV1> {
  const resolution = resolveProposals(
    input.sourceText,
    input.proposals,
    (_proposal, anchor) => `${anchor.startOffset}:${anchor.endOffset}`,
  );
  const structuralPositions = parseCandidatePositions(input.sourceText);
  const allBullets = structuralPositions.flatMap((position) => parseBullets(input.sourceText, position, input.sourceDocumentId));
  const enrichment = new CandidateProofExtractorV1();
  const claims: CandidateProofClaim[] = [];
  const proposalRejections = [...resolution.rejections];
  for (const { proposal, proposalIndex, anchor } of resolution.accepted) {
    try {
      const parent = parentForCandidateProposal(proposal, anchor, structuralPositions, allBullets);
      const proofTypes = canonicalProofTypes(proposal.proofTypes);
      claims.push({
      claimId: `claim:${input.sourceDocumentId}:${anchor.startOffset}_${anchor.endOffset}:${proofTypes[0]}`,
      sourceDocumentId: input.sourceDocumentId,
      ...(parent.position === undefined ? {} : { positionId: parent.position.positionId, title: parent.position.title,
        employer: parent.position.employer, dates: parent.position.dates }),
      parentBulletExactText: parent.parentText, parentBulletStartOffset: parent.parentStart, parentBulletEndOffset: parent.parentEnd,
      exactText: proposal.exactQuote, startOffset: anchor.startOffset, endOffset: anchor.endOffset,
      evidenceClass: proposal.evidenceClass, proofTypes,
      // These existing public helpers are deterministic source normalization,
      // not semantic extraction. They are deliberately shared for parity.
      metrics: enrichment.extractMetrics(proposal.exactQuote, anchor.startOffset),
      groundedEntities: enrichment.extractEntities(proposal.exactQuote, anchor.startOffset),
      });
    } catch (error) {
      if (!(error instanceof ExpectedProposalRejection)) throw error;
      proposalRejections.push({ proposalIndex, exactQuote: proposal.exactQuote, code: error.code });
    }
  }
  for (const claim of claims.filter((candidate) => candidate.evidenceClass === "WORK_HISTORY")) {
    const bullet = allBullets.find((candidate) => candidate.startOffset === claim.parentBulletStartOffset && candidate.endOffset === claim.parentBulletEndOffset);
    if (!bullet) throw new Error("A work-history proposal did not retain its structural parent bullet.");
    bullet.claims.push(claim);
  }
  const positions: CandidatePosition[] = structuralPositions.map((position) => ({ ...position,
    bullets: allBullets.filter((bullet) => bullet.startOffset >= position.startOffset && bullet.endOffset <= position.endOffset) }));
  const selfSummaries = claims.filter((claim) => claim.evidenceClass === "SELF_SUMMARY");
  const capabilityLabels = claims.filter((claim) => claim.evidenceClass === "CAPABILITY_LABEL");
  const output: CandidateProofOutputV1 = {
    sourceDocumentId: input.sourceDocumentId, rawDocumentLength: input.sourceText.length, positions, selfSummaries, capabilityLabels,
    education: [], allBullets, allClaims: claims,
    metadata: { extractorVersion: "CandidateProofExtractorV1", totalProfessionalExperienceBullets: allBullets.length,
      bulletsRetained: allBullets.length, bulletsWithSpecializedClaims: allBullets.filter((bullet) => bullet.claims.length > 0).length,
      bulletsWithoutSpecializedClaims: allBullets.filter((bullet) => bullet.claims.length === 0).length,
      proposalCounts: { proposedClaims: input.proposals.length, acceptedClaims: claims.length, rejectedClaims: proposalRejections.length } },
  };
  return { output, proposalRejections };
}
