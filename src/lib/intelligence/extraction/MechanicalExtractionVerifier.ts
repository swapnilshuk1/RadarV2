import type {
  CandidateProofClaim,
  CandidateProofOutputV1,
  CandidateSourceBullet,
  CandidateProofType,
  MetricComparator,
  MetricType,
} from "./CandidateProofExtractorV1";
import type {
  RoleIntelligenceOutputV1,
  RolePropositionAtom,
  RoleSemanticType,
  RoleSubject,
  SectionType,
} from "./RoleIntelligenceExtractorV1";
import type {
  CandidateDocumentSourceRef,
  OpportunityVersionSourceRef,
} from "@/lib/domain/source_provenance";
import type { ResolvedSourceSnapshot } from "@/lib/provenance/SourceSnapshotResolver";

const ROLE_SEMANTIC_TYPES = new Set<RoleSemanticType>([
  "ROLE_PURPOSE", "RESPONSIBILITY", "OUTCOME", "SUCCESS_METRIC",
  "HARD_REQUIREMENT", "PREFERRED_REQUIREMENT", "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY", "BOARD_EXPOSURE", "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY", "PROFITABILITY_ACCOUNTABILITY", "BUDGET_SCOPE",
  "DECISION_AUTHORITY", "PEOPLE_LEADERSHIP", "PEOPLE_SCALE", "GREENFIELD_BUILD",
  "TRANSFORMATION", "GEOGRAPHIC_SCOPE", "REGULATORY_SCOPE", "PRODUCT_SCOPE",
  "CUSTOMER_SCOPE", "CHANNEL_SCOPE", "COMPANY_CONTEXT", "WORK_CONDITION",
]);
const ROLE_SUBJECTS = new Set<RoleSubject>(["ROLE", "COMPANY", "RECRUITING_PROCESS"]);
const SECTION_TYPES = new Set<SectionType>([
  "ABOUT_COMPANY", "ROLE_OVERVIEW", "RESPONSIBILITIES", "REQUIREMENTS",
  "PREFERRED", "SUCCESS", "WHO_YOU_WORK_WITH", "WHY_JOIN", "BENEFITS",
  "APPLICATION", "LEGAL_EEO", "STRUCTURAL_METADATA", "OTHER",
]);
const PROOF_TYPES = new Set<CandidateProofType>([
  "OUTCOME", "OWNERSHIP", "FINANCIAL_SCOPE", "PEOPLE_SCOPE", "GEOGRAPHIC_SCOPE",
  "ORGANIZATION_BUILD", "TRANSFORMATION", "MANDATE", "PRODUCT_LAUNCH",
  "CUSTOMER_GROWTH", "REVENUE_GROWTH", "COST_EFFICIENCY", "PIPELINE_GENERATION",
  "TECHNOLOGY_IMPLEMENTATION", "PARTNERSHIP", "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT", "CAPABILITY_LABEL",
]);
const METRIC_TYPES = new Set<MetricType>([
  "CURRENCY_AMOUNT", "PERCENTAGE_CHANGE", "PERCENTAGE_VALUE", "PEOPLE_COUNT",
  "MARKET_COUNT", "LOCATION_COUNT", "LEAD_COUNT", "TIMELINE", "COUNT",
]);
const METRIC_COMPARATORS = new Set<MetricComparator>([
  "EXACT", "AT_LEAST", "MORE_THAN", "APPROXIMATELY", "RANGE",
]);

export class MechanicalExtractionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MechanicalExtractionVerificationError";
  }
}

/**
 * Provider-neutral gate for mechanically checkable extraction truth. It does
 * not infer semantics or repair provider output: invalid proposals fail closed.
 */
export class MechanicalExtractionVerifier {
  verifyRole(
    source: OpportunityVersionSourceRef,
    snapshot: ResolvedSourceSnapshot,
    output: RoleIntelligenceOutputV1,
  ): RoleIntelligenceOutputV1 {
    const text = this.requireExactTextSnapshot(source, snapshot);
    if (output.canonicalJobId !== source.canonicalJobId) {
      this.fail("Role output canonicalJobId does not match its immutable source.");
    }
    if (output.rawTextLength !== text.length) this.fail("Role output rawTextLength mismatch.");

    const ids = new Set<string>();
    const anchors = new Set<string>();
    for (const atom of output.atoms) {
      this.verifyRoleAtom(text, atom, ids, anchors);
    }
    for (const section of output.sections) {
      if (!SECTION_TYPES.has(section.type)) this.fail(`Invalid role section: ${section.type}`);
      this.verifySpan(text, section.headingStart, section.headingEnd, section.headingText, "section heading");
      if (section.contentStart < section.headingEnd || section.contentEnd > text.length || section.contentStart > section.contentEnd) {
        this.fail("Invalid role section content bounds.");
      }
      if (text.slice(section.contentStart, section.contentEnd) !== section.rawContent) {
        this.fail("Role section rawContent does not resolve exactly.");
      }
    }
    return output;
  }

  verifyCandidate(
    source: CandidateDocumentSourceRef,
    snapshot: ResolvedSourceSnapshot,
    output: CandidateProofOutputV1,
  ): CandidateProofOutputV1 {
    const text = this.requireExactTextSnapshot(source, snapshot);
    if (output.sourceDocumentId !== source.documentId) {
      this.fail("Candidate output document ID does not match its immutable source.");
    }
    if (output.rawDocumentLength !== text.length) this.fail("Candidate output rawDocumentLength mismatch.");

    const claimIds = new Set<string>();
    const bulletIds = new Set<string>();
    for (const bullet of output.allBullets) this.verifyBullet(text, bullet, bulletIds, claimIds);
    for (const claim of [...output.selfSummaries, ...output.capabilityLabels]) {
      this.verifyClaim(text, claim, claimIds);
    }
    for (const education of output.education) {
      this.verifySpan(text, education.startOffset, education.endOffset, education.rawText, "education");
    }
    return output;
  }

  private requireExactTextSnapshot(
    expected: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
    snapshot: ResolvedSourceSnapshot,
  ): string {
    if (!sameSourceRef(expected, snapshot.ref)) this.fail("Provider source reference differs from resolved immutable snapshot.");
    if (snapshot.text === null) this.fail("Text extraction requires a resolved text source snapshot.");
    return snapshot.text;
  }

  private verifyRoleAtom(text: string, atom: RolePropositionAtom, ids: Set<string>, anchors: Set<string>): void {
    this.verifySpan(text, atom.startOffset, atom.endOffset, atom.exactText, "role atom");
    if (!ROLE_SUBJECTS.has(atom.subject)) this.fail(`Invalid role subject: ${atom.subject}`);
    if (!SECTION_TYPES.has(atom.section)) this.fail(`Invalid role section: ${atom.section}`);
    if (atom.semanticType !== undefined && !ROLE_SEMANTIC_TYPES.has(atom.semanticType)) {
      this.fail(`Invalid role semantic type: ${atom.semanticType}`);
    }
    if (!Number.isFinite(atom.confidence) || atom.confidence < 0 || atom.confidence > 1) {
      this.fail("Role atom confidence must be finite and within [0, 1].");
    }
    if (ids.has(atom.id)) this.fail(`Duplicate role atom ID: ${atom.id}`);
    ids.add(atom.id);
    const anchor = `${atom.startOffset}:${atom.endOffset}:${atom.semanticType ?? "UNCLASSIFIED"}`;
    if (anchors.has(anchor)) this.fail(`Duplicate role semantic anchor: ${anchor}`);
    anchors.add(anchor);
  }

  private verifyBullet(text: string, bullet: CandidateSourceBullet, ids: Set<string>, claimIds: Set<string>): void {
    this.verifySpan(text, bullet.startOffset, bullet.endOffset, bullet.exactText, "candidate bullet");
    if (ids.has(bullet.bulletId)) this.fail(`Duplicate candidate bullet ID: ${bullet.bulletId}`);
    ids.add(bullet.bulletId);
    for (const claim of bullet.claims) {
      if (claim.startOffset < bullet.startOffset || claim.endOffset > bullet.endOffset) {
        this.fail("Candidate claim lies outside its parent bullet.");
      }
      this.verifyClaim(text, claim, claimIds);
    }
  }

  private verifyClaim(text: string, claim: CandidateProofClaim, ids: Set<string>): void {
    this.verifySpan(text, claim.startOffset, claim.endOffset, claim.exactText, "candidate claim");
    this.verifySpan(text, claim.parentBulletStartOffset, claim.parentBulletEndOffset, claim.parentBulletExactText, "parent bullet");
    if (claim.startOffset < claim.parentBulletStartOffset || claim.endOffset > claim.parentBulletEndOffset) {
      this.fail("Candidate claim lies outside its declared parent bullet.");
    }
    if (ids.has(claim.claimId)) this.fail(`Duplicate candidate claim ID: ${claim.claimId}`);
    ids.add(claim.claimId);
    for (const proofType of claim.proofTypes) if (!PROOF_TYPES.has(proofType)) this.fail(`Invalid candidate proof type: ${proofType}`);
    for (const metric of claim.metrics) {
      this.verifySpan(text, metric.startOffset, metric.endOffset, metric.exactText, "candidate metric");
      if (!METRIC_TYPES.has(metric.metricType) || !METRIC_COMPARATORS.has(metric.comparator) || !Number.isFinite(metric.normalizedValue)) {
        this.fail("Invalid deterministic candidate metric.");
      }
    }
  }

  private verifySpan(text: string, start: number, end: number, exactText: string, label: string): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
      this.fail(`Invalid ${label} span.`);
    }
    if (text.slice(start, end) !== exactText) this.fail(`Unresolvable ${label} span.`);
  }

  private fail(message: string): never {
    throw new MechanicalExtractionVerificationError(message);
  }
}

function sameSourceRef(
  left: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  right: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
