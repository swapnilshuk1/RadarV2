import type {
  CandidateProofClaim,
  CandidateProofOutputV1,
  CandidatePosition,
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
    if (output.caseId.trim().length === 0) this.fail("Role output caseId must be non-empty.");
    if (output.metadata.extractorVersion !== "RoleIntelligenceExtractorV1") this.fail("Invalid role extractor version.");
    this.verifyCounts(output.metadata.proposalCounts, output.atoms.length, "role atom");

    const ids = new Set<string>();
    const anchors = new Set<string>();
    for (const atom of output.atoms) {
      this.verifyRoleAtom(text, atom, output.caseId, ids, anchors);
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
    if (output.metadata.extractorVersion !== "CandidateProofExtractorV1") this.fail("Invalid candidate extractor version.");
    if (output.masthead) this.verifySpan(text, output.masthead.startOffset, output.masthead.endOffset, output.masthead.rawText, "candidate masthead");

    const claimIds = new Set<string>();
    const bulletIds = new Set<string>();
    const positionIds = new Set<string>();
    const positionBullets: CandidateSourceBullet[] = [];
    for (const position of output.positions) this.verifyPosition(text, source.documentId, position, positionIds, positionBullets, bulletIds, claimIds);
    this.assertSameBulletCollection(positionBullets, output.allBullets);
    for (const bullet of output.allBullets) this.verifyBullet(text, source.documentId, bullet, bulletIds, claimIds, undefined, true);
    for (const claim of [...output.selfSummaries, ...output.capabilityLabels]) this.verifyClaim(text, source.documentId, claim, claimIds);
    for (const education of output.education) {
      this.verifySpan(text, education.startOffset, education.endOffset, education.rawText, "education");
    }
    this.assertSameClaimCollection(output, claimIds);
    if (output.metadata.totalProfessionalExperienceBullets !== output.allBullets.length || output.metadata.bulletsRetained !== output.allBullets.length) this.fail("Candidate bullet metadata does not match allBullets.");
    const withClaims = output.allBullets.filter((bullet) => bullet.claims.length > 0).length;
    if (output.metadata.bulletsWithSpecializedClaims !== withClaims || output.metadata.bulletsWithoutSpecializedClaims !== output.allBullets.length - withClaims) this.fail("Candidate specialized-claim metadata does not match bullets.");
    this.verifyCounts(output.metadata.proposalCounts, output.allClaims.length, "candidate claim");
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

  private verifyRoleAtom(text: string, atom: RolePropositionAtom, caseId: string, ids: Set<string>, anchors: Set<string>): void {
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
    const expectedId = `role_atom:${caseId}:${atom.startOffset}_${atom.endOffset}:${atom.semanticType ?? "UNCLASSIFIED"}`;
    if (atom.id !== expectedId) this.fail("Role atom ID does not match its stable derivation.");
    if (![
      "DETERMINISTIC_SECTION", "DETERMINISTIC_META_LINE", "DETERMINISTIC_PROPOSITION_RULE", "SEMANTIC_FALLBACK",
    ].includes(atom.extractionMethod)) this.fail("Invalid role atom extraction method.");
    if (atom.epistemicMarker !== "EXACT_SOURCE_STATEMENT") this.fail("Invalid role atom epistemic marker.");
    this.verifyRoleDetails(atom);
    ids.add(atom.id);
    const anchor = `${atom.startOffset}:${atom.endOffset}:${atom.semanticType ?? "UNCLASSIFIED"}`;
    if (anchors.has(anchor)) this.fail(`Duplicate role semantic anchor: ${anchor}`);
    anchors.add(anchor);
  }

  private verifyPosition(text: string, sourceDocumentId: string, position: CandidatePosition, positionIds: Set<string>, positionBullets: CandidateSourceBullet[], bulletIds: Set<string>, claimIds: Set<string>): void {
    this.verifySpan(text, position.startOffset, position.endOffset, text.slice(position.startOffset, position.endOffset), "candidate position");
    if (positionIds.has(position.positionId)) this.fail(`Duplicate candidate position ID: ${position.positionId}`);
    const expectedId = `pos:${position.employer.replace(/\s+/g, "_")}:${position.startOffset}`;
    if (position.positionId !== expectedId) this.fail("Candidate position ID does not match its stable derivation.");
    positionIds.add(position.positionId);
    for (const bullet of position.bullets) {
      if (bullet.startOffset < position.startOffset || bullet.endOffset > position.endOffset) this.fail("Candidate bullet lies outside its parent position.");
      this.verifyBullet(text, sourceDocumentId, bullet, bulletIds, claimIds, position.positionId);
      positionBullets.push(bullet);
    }
  }

  private verifyBullet(text: string, sourceDocumentId: string, bullet: CandidateSourceBullet, ids: Set<string>, claimIds: Set<string>, positionId?: string, alreadyVerified = false): void {
    this.verifySpan(text, bullet.startOffset, bullet.endOffset, bullet.exactText, "candidate bullet");
    if (!alreadyVerified) {
      if (ids.has(bullet.bulletId)) this.fail(`Duplicate candidate bullet ID: ${bullet.bulletId}`);
      if (positionId) {
        const expectedId = `bullet:pos:${sourceDocumentId}:${positionId.slice("pos:".length, positionId.lastIndexOf(":"))}:${bullet.startOffset}_${bullet.endOffset}`;
        if (bullet.bulletId !== expectedId) this.fail("Candidate bullet ID does not match its stable derivation.");
      }
      ids.add(bullet.bulletId);
    }
    for (const claim of bullet.claims) {
      if (claim.startOffset < bullet.startOffset || claim.endOffset > bullet.endOffset) {
        this.fail("Candidate claim lies outside its parent bullet.");
      }
      this.verifyClaim(text, sourceDocumentId, claim, claimIds, positionId, alreadyVerified);
    }
  }

  private verifyClaim(text: string, sourceDocumentId: string, claim: CandidateProofClaim, ids: Set<string>, expectedPositionId?: string, alreadyVerified = false): void {
    this.verifySpan(text, claim.startOffset, claim.endOffset, claim.exactText, "candidate claim");
    this.verifySpan(text, claim.parentBulletStartOffset, claim.parentBulletEndOffset, claim.parentBulletExactText, "parent bullet");
    if (claim.startOffset < claim.parentBulletStartOffset || claim.endOffset > claim.parentBulletEndOffset) {
      this.fail("Candidate claim lies outside its declared parent bullet.");
    }
    if (claim.sourceDocumentId !== sourceDocumentId) this.fail("Candidate claim sourceDocumentId does not match immutable source.");
    if (expectedPositionId !== undefined && claim.positionId !== expectedPositionId) this.fail("Candidate claim position does not match its parent position.");
    if (!alreadyVerified) {
      if (ids.has(claim.claimId)) this.fail(`Duplicate candidate claim ID: ${claim.claimId}`);
      const expectedId = `claim:${sourceDocumentId}:${claim.startOffset}_${claim.endOffset}:${claim.proofTypes[0] ?? "CLAIM"}`;
      if (claim.claimId !== expectedId) this.fail("Candidate claim ID does not match its stable derivation.");
      ids.add(claim.claimId);
    }
    for (const proofType of claim.proofTypes) if (!PROOF_TYPES.has(proofType)) this.fail(`Invalid candidate proof type: ${proofType}`);
    for (const metric of claim.metrics) {
      this.verifySpan(text, metric.startOffset, metric.endOffset, metric.exactText, "candidate metric");
      if (!METRIC_TYPES.has(metric.metricType) || !METRIC_COMPARATORS.has(metric.comparator) || !Number.isFinite(metric.normalizedValue)) {
        this.fail("Invalid deterministic candidate metric.");
      }
    }
    const entities = new Set<string>();
    for (const entity of claim.groundedEntities) {
      this.verifySpan(text, entity.startOffset, entity.endOffset, entity.exactText, "candidate grounded entity");
      if (![
        "COMPANY", "PRODUCT", "PLATFORM", "MARKET", "CLIENT", "BRAND", "GEOGRAPHY", "ORGANIZATION",
      ].includes(entity.category)) this.fail("Invalid grounded entity category.");
      const anchor = `${entity.startOffset}:${entity.endOffset}:${entity.category}`;
      if (entities.has(anchor)) this.fail("Duplicate grounded entity anchor.");
      entities.add(anchor);
    }
  }

  private assertSameBulletCollection(expected: CandidateSourceBullet[], actual: CandidateSourceBullet[]): void {
    if (expected.length !== actual.length) this.fail("allBullets does not equal the union of position bullets.");
    for (let index = 0; index < expected.length; index += 1) {
      if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) this.fail("allBullets differs from the position-bullet collection.");
    }
  }

  private assertSameClaimCollection(output: CandidateProofOutputV1, verifiedClaimIds: Set<string>): void {
    const expected = [
      ...output.allBullets.flatMap((bullet) => bullet.claims),
      ...output.selfSummaries,
      ...output.capabilityLabels,
    ];
    if (expected.length !== output.allClaims.length || verifiedClaimIds.size !== output.allClaims.length) {
      this.fail("allClaims does not account for every extracted claim exactly once.");
    }
    const expectedById = new Map(expected.map((claim) => [claim.claimId, claim]));
    for (const claim of output.allClaims) {
      const expectedClaim = expectedById.get(claim.claimId);
      if (!expectedClaim || JSON.stringify(expectedClaim) !== JSON.stringify(claim)) {
        this.fail("allClaims differs from the union of bullet, summary, and capability claims.");
      }
    }
  }

  private verifyCounts(
    counts: { proposedAtoms?: number; acceptedAtoms?: number; rejectedAtoms?: number; proposedClaims?: number; acceptedClaims?: number; rejectedClaims?: number },
    accepted: number,
    label: string,
  ): void {
    const proposed = counts.proposedAtoms ?? counts.proposedClaims;
    const acceptedCount = counts.acceptedAtoms ?? counts.acceptedClaims;
    const rejected = counts.rejectedAtoms ?? counts.rejectedClaims;
    if (![proposed, acceptedCount, rejected].every((value) => Number.isInteger(value) && value! >= 0)) {
      this.fail(`Invalid ${label} proposal counts.`);
    }
    if (acceptedCount !== accepted || proposed! < acceptedCount! + rejected!) {
      this.fail(`${label} proposal counts do not account for accepted output.`);
    }
  }

  private verifyRoleDetails(atom: RolePropositionAtom): void {
    if (atom.normalizedClaim) {
      if (atom.normalizedClaim.predicate !== undefined && typeof atom.normalizedClaim.predicate !== "string") this.fail("Role normalized predicate must be a string.");
      if (atom.normalizedClaim.object !== undefined && typeof atom.normalizedClaim.object !== "string") this.fail("Role normalized object must be a string.");
    }
    if (atom.requirement) {
      if (!["HARD", "PREFERRED", "UNSTATED"].includes(atom.requirement.materiality)) this.fail("Invalid requirement materiality.");
      if (atom.requirement.materialityCue !== null && typeof atom.requirement.materialityCue !== "string") this.fail("Invalid requirement materiality cue.");
      if (!["EXPERIENCE_YEARS", "INDUSTRY", "DOMAIN", "CAPABILITY", "EDUCATION", "CERTIFICATION", "TECHNOLOGY", "GEOGRAPHY", "WORK_AUTHORIZATION", "LICENCE", "PORTFOLIO", "OTHER"].includes(atom.requirement.requirementDimension)) this.fail("Invalid requirement dimension.");
      const years = atom.requirement.parsedYears;
      if (years && Object.values(years).some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) this.fail("Invalid parsed requirement years.");
    }
    if (atom.actionRole) {
      if (!["OWN", "LEAD", "EXECUTE", "COLLABORATE"].includes(atom.actionRole.ownershipLevel)) this.fail("Invalid action role ownership level.");
      for (const value of [atom.actionRole.targetOutcome, atom.actionRole.metric]) if (value !== undefined && value !== null && typeof value !== "string") this.fail("Invalid action role detail.");
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
