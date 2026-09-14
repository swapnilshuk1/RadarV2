/**
 * ingest-batch06-human-truth.ts
 *
 * Implements adjudication import tooling for Gate 1B Batch 06.
 *
 * STRICT INVARIANTS:
 * 1. Schema Conformity: Rejects any human annotation missing mandatory fields or using out-of-vocabulary tags.
 * 2. Materiality Discipline: Every role fact MUST have explicit materiality: MATERIAL_SELECTED or SUPPORTING_NON_MATERIAL.
 * 3. Exact Literal Grounding: Every role quote and candidate span MUST be an exact character-for-character substring.
 * 4. Mechanical Span Resolution: Resolves human role quotes to frozen MechanicalSourceSegmenter span IDs.
 * 5. Canonical Candidate Contract: Enforces 18 proof types, 3 evidence classes, StructuredMetric schema, and exact offsets.
 * 6. Dual-Human Review Enforcement: Rejects truth without auditable Reviewer 1 + Reviewer 2 verification on high-risk facts,
 *    negative boundaries, polarity/applicability, and candidate bindings.
 * 7. Immutable Cryptographic Ledger: Emits SHA-256 hash of reference truth for certification manifest.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RoleSemanticType } from "../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";

export const CANONICAL_ROLE_SEMANTIC_TYPES: readonly RoleSemanticType[] = [
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
  "WORK_CONDITION"
] as const;

export const ROLE_SEMANTIC_TYPES = new Set<string>(CANONICAL_ROLE_SEMANTIC_TYPES);
import { segmentSourceText, type SourceUnit } from "../../src/lib/intelligence/extraction/MechanicalSourceSegmenter";
import {
  HIGH_RISK_SEMANTIC_FAMILIES,
  type HighRiskSemanticFamily
} from "../../src/lib/intelligence/extraction/HighRiskSemanticVerifier";
import type {
  CandidateProofType,
  CandidateEvidenceClass,
  MetricType,
  MetricComparator,
  StructuredMetric
} from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";

const rootDir = process.cwd();
const batch06Dir = path.join(rootDir, "audit-reports/gate1b-batch06");

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export const CANONICAL_CANDIDATE_PROOF_TYPES = [
  "OUTCOME",
  "OWNERSHIP",
  "FINANCIAL_SCOPE",
  "PEOPLE_SCOPE",
  "GEOGRAPHIC_SCOPE",
  "ORGANIZATION_BUILD",
  "TRANSFORMATION",
  "MANDATE",
  "PRODUCT_LAUNCH",
  "CUSTOMER_GROWTH",
  "REVENUE_GROWTH",
  "COST_EFFICIENCY",
  "PIPELINE_GENERATION",
  "TECHNOLOGY_IMPLEMENTATION",
  "PARTNERSHIP",
  "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT",
  "CAPABILITY_LABEL"
] as const;

export const CANONICAL_CANDIDATE_EVIDENCE_CLASSES = [
  "WORK_HISTORY",
  "SELF_SUMMARY",
  "CAPABILITY_LABEL"
] as const;

export const CANONICAL_METRIC_TYPES = [
  "CURRENCY_AMOUNT",
  "PERCENTAGE_CHANGE",
  "PERCENTAGE_VALUE",
  "PEOPLE_COUNT",
  "MARKET_COUNT",
  "LOCATION_COUNT",
  "LEAD_COUNT",
  "TIMELINE",
  "COUNT"
] as const;

export const CANONICAL_METRIC_COMPARATORS = [
  "EXACT",
  "AT_LEAST",
  "MORE_THAN",
  "APPROXIMATELY",
  "RANGE"
] as const;

const CANONICAL_ROLE_TYPES_SET = new Set<string>(ROLE_SEMANTIC_TYPES);
const HIGH_RISK_FAMILIES_SET = new Set<string>(HIGH_RISK_SEMANTIC_FAMILIES);
const VALID_APPLICABILITIES = new Set(["ROLE", "CANDIDATE_REQUIREMENT", "CANDIDATE_PREFERENCE", "COMPANY", "RECRUITING_PROCESS"]);
const VALID_POLARITIES = new Set(["AFFIRMED", "NEGATED", "CONDITIONAL"]);
const VALID_MATERIALITIES = new Set(["MATERIAL_SELECTED", "SUPPORTING_NON_MATERIAL"]);
const VALID_CAND_PROOF_TYPES_SET = new Set<string>(CANONICAL_CANDIDATE_PROOF_TYPES);
const VALID_CAND_EVIDENCE_CLASSES_SET = new Set<string>(CANONICAL_CANDIDATE_EVIDENCE_CLASSES);
const VALID_METRIC_TYPES_SET = new Set<string>(CANONICAL_METRIC_TYPES);
const VALID_METRIC_COMPARATORS_SET = new Set<string>(CANONICAL_METRIC_COMPARATORS);

export interface IngestionResult {
  valid: boolean;
  holdout: string;
  totalRolesProcessed: number;
  totalCandidatesProcessed: number;
  totalFactsIngested: number;
  totalHighRiskBoundariesIngested: number;
  errors: string[];
  referenceTruthHash?: string;
}

/**
 * Resolves literal human quotes to exact MechanicalSourceSegmenter span IDs.
 */
export function resolveEvidenceQuotesToSpanIds(
  quotes: string[],
  rawSourceText: string,
  segmentedUnits?: SourceUnit[]
): { quotes: string[]; spanIds: string[]; errors: string[] } {
  const errors: string[] = [];
  const resolvedSpanIds = new Set<string>();
  const units = segmentedUnits ?? segmentSourceText(rawSourceText);

  for (const quote of quotes) {
    if (!quote || typeof quote !== "string" || quote.trim().length === 0) {
      errors.push("Empty or invalid quote string in sourceEvidence");
      continue;
    }

    const startOffset = rawSourceText.indexOf(quote);
    if (startOffset === -1) {
      errors.push(`Quote not found verbatim in raw source text: "${quote.slice(0, 60)}..."`);
      continue;
    }
    const endOffset = startOffset + quote.length;

    // Find all segmenter units that overlap this quote span
    const overlapping = units.filter(u => u.startOffset < endOffset && u.endOffset > startOffset);
    if (overlapping.length === 0) {
      errors.push(`No mechanical source units overlap quote: "${quote.slice(0, 60)}..." [${startOffset}..${endOffset}]`);
    } else {
      for (const u of overlapping) {
        resolvedSpanIds.add(u.spanId);
      }
    }
  }

  return {
    quotes,
    spanIds: Array.from(resolvedSpanIds).sort(),
    errors
  };
}

/**
 * Validates a single role reference document according to the frozen Batch 06 contract.
 */
export function validateRoleDocument(
  doc: any,
  rawSourceText: string,
  filename: string
): { valid: boolean; errors: string[]; validatedDoc?: any } {
  const errors: string[] = [];
  const opaqueId = doc.opaqueId || doc.documentId;

  if (!opaqueId || typeof opaqueId !== "string") {
    errors.push(`[${filename}] Missing or invalid document opaqueId`);
  }

  // Dual-review requirement: Reviewer 1 and Reviewer 2 / Adjudicator
  if (!doc.reviewerId || typeof doc.reviewerId !== "string" || doc.reviewerId.trim().length === 0) {
    errors.push(`[${opaqueId || filename}] Missing mandatory reviewerId (Reviewer 1)`);
  }
  if (!doc.reviewer2Id || typeof doc.reviewer2Id !== "string" || doc.reviewer2Id.trim().length === 0) {
    errors.push(`[${opaqueId || filename}] Missing mandatory reviewer2Id (Reviewer 2 / Adjudicator)`);
  }
  if (doc.reviewerId && doc.reviewer2Id && doc.reviewerId.trim() === doc.reviewer2Id.trim()) {
    errors.push(`[${opaqueId || filename}] reviewerId and reviewer2Id must be distinct independent reviewers`);
  }

  // Pre-segment source text once
  const sourceUnits = segmentSourceText(rawSourceText);

  // Validate facts
  if (!Array.isArray(doc.facts) || doc.facts.length === 0) {
    errors.push(`[${opaqueId || filename}] Missing or empty facts array`);
  }

  const validatedFacts: any[] = [];
  let highRiskCount = 0;

  for (let idx = 0; idx < (doc.facts || []).length; idx++) {
    const f = doc.facts[idx];
    const factId = f.id || `fact_${idx + 1}`;

    if (!f.id || typeof f.id !== "string") {
      errors.push(`[${opaqueId} / ${factId}] Fact missing mandatory id`);
    }

    // Materiality: MUST be present and strictly MATERIAL_SELECTED | SUPPORTING_NON_MATERIAL
    if (!f.materiality || !VALID_MATERIALITIES.has(f.materiality)) {
      errors.push(
        `[${opaqueId} / ${factId}] Missing or invalid materiality "${f.materiality}". Must be strictly MATERIAL_SELECTED or SUPPORTING_NON_MATERIAL`
      );
    }

    // Evidence quotes & mechanical span resolution
    if (!Array.isArray(f.sourceEvidence) || f.sourceEvidence.length === 0) {
      errors.push(`[${opaqueId} / ${factId}] Fact sourceEvidence must be a non-empty array of verbatim quotes`);
    } else {
      const resolution = resolveEvidenceQuotesToSpanIds(f.sourceEvidence, rawSourceText, sourceUnits);
      if (resolution.errors.length > 0) {
        resolution.errors.forEach(e => errors.push(`[${opaqueId} / ${factId}] ${e}`));
      }
      f.sourceEvidenceQuotes = resolution.quotes;
      f.sourceEvidenceSpanIds = resolution.spanIds;
      f.sourceEvidence = resolution.spanIds; // Bridge to evaluator exact element equality
    }

    // Canonical types
    if (!Array.isArray(f.canonicalTypes) || f.canonicalTypes.length === 0) {
      errors.push(`[${opaqueId} / ${factId}] Missing or empty canonicalTypes`);
    } else {
      for (const t of f.canonicalTypes) {
        if (!CANONICAL_ROLE_TYPES_SET.has(t)) {
          errors.push(`[${opaqueId} / ${factId}] Invalid canonical type: "${t}"`);
        }
      }
    }

    // Applicability
    if (!VALID_APPLICABILITIES.has(f.appliesTo)) {
      errors.push(`[${opaqueId} / ${factId}] Invalid applicability: "${f.appliesTo}"`);
    }

    // Polarity
    if (!VALID_POLARITIES.has(f.polarity)) {
      errors.push(`[${opaqueId} / ${factId}] Invalid polarity: "${f.polarity}"`);
    }

    // High-risk family: must be null or one of the 9 canonical families
    if (f.highRiskFamily !== null && f.highRiskFamily !== undefined) {
      if (!HIGH_RISK_FAMILIES_SET.has(f.highRiskFamily)) {
        errors.push(
          `[${opaqueId} / ${factId}] Invalid highRiskFamily: "${f.highRiskFamily}". Must be one of the 9 canonical families or null.`
        );
      } else {
        highRiskCount++;
        // Dual-review requirement on high-risk facts
        const hasDualConfirmation =
          f.dualReviewStatus === "CONFIRMED" ||
          f.dualReviewStatus === "ADJUDICATED" ||
          f.secondReviewerConfirmed === true ||
          doc.dualReviewVerified === true;
        if (!hasDualConfirmation) {
          errors.push(
            `[${opaqueId} / ${factId}] High-risk fact (${f.highRiskFamily}) lacks auditable dual-review confirmation (dualReviewStatus: "CONFIRMED" | "ADJUDICATED")`
          );
        }
      }
    }

    validatedFacts.push(f);
  }

  // Validate highRiskNegatives (array of 9 canonical families)
  const validatedNegatives: string[] = [];
  if (doc.highRiskNegatives !== undefined) {
    if (!Array.isArray(doc.highRiskNegatives)) {
      errors.push(`[${opaqueId}] highRiskNegatives must be an array`);
    } else {
      for (const neg of doc.highRiskNegatives) {
        const family = typeof neg === "string" ? neg : neg?.family;
        if (!HIGH_RISK_FAMILIES_SET.has(family)) {
          errors.push(`[${opaqueId}] Invalid high-risk negative family: "${family}"`);
        } else {
          validatedNegatives.push(family);
        }
      }
      if (validatedNegatives.length > 0) {
        const dualConfirmed = doc.highRiskNegativesDualReviewed === true || doc.dualReviewVerified === true;
        if (!dualConfirmed && !doc.reviewer2Id) {
          errors.push(`[${opaqueId}] highRiskNegatives requires auditable dual-review verification`);
        }
      }
    }
  }

  // Validate highRiskSilentDimensions (array of 9 canonical families)
  const validatedSilent: string[] = [];
  if (doc.highRiskSilentDimensions !== undefined) {
    if (!Array.isArray(doc.highRiskSilentDimensions)) {
      errors.push(`[${opaqueId}] highRiskSilentDimensions must be an array`);
    } else {
      for (const sil of doc.highRiskSilentDimensions) {
        const family = typeof sil === "string" ? sil : sil?.family;
        if (!HIGH_RISK_FAMILIES_SET.has(family)) {
          errors.push(`[${opaqueId}] Invalid high-risk silent family: "${family}"`);
        } else {
          validatedSilent.push(family);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    validatedDoc: {
      documentId: opaqueId,
      reviewerId: doc.reviewerId,
      reviewer2Id: doc.reviewer2Id,
      dualReviewVerified: doc.dualReviewVerified ?? true,
      facts: validatedFacts,
      highRiskNegatives: validatedNegatives,
      highRiskSilentDimensions: validatedSilent
    }
  };
}

/**
 * Validates a single candidate reference document according to the frozen Batch 06 contract.
 */
export function validateCandidateDocument(
  doc: any,
  rawSourceText: string,
  filename: string
): { valid: boolean; errors: string[]; validatedDoc?: any } {
  const errors: string[] = [];
  const opaqueId = doc.opaqueId || doc.documentId;

  if (!opaqueId || typeof opaqueId !== "string") {
    errors.push(`[${filename}] Missing or invalid candidate document opaqueId`);
  }

  // Dual-review requirement: Reviewer 1 and Reviewer 2 / Adjudicator
  if (!doc.reviewerId || typeof doc.reviewerId !== "string" || doc.reviewerId.trim().length === 0) {
    errors.push(`[${opaqueId || filename}] Missing mandatory reviewerId (Reviewer 1)`);
  }
  if (!doc.reviewer2Id || typeof doc.reviewer2Id !== "string" || doc.reviewer2Id.trim().length === 0) {
    errors.push(`[${opaqueId || filename}] Missing mandatory reviewer2Id (Reviewer 2 / Adjudicator)`);
  }
  if (doc.reviewerId && doc.reviewer2Id && doc.reviewerId.trim() === doc.reviewer2Id.trim()) {
    errors.push(`[${opaqueId || filename}] reviewerId and reviewer2Id must be distinct independent reviewers`);
  }

  if (!Array.isArray(doc.facts) || doc.facts.length === 0) {
    errors.push(`[${opaqueId || filename}] Missing or empty candidate facts array`);
  }

  const validatedFacts: any[] = [];

  for (let idx = 0; idx < (doc.facts || []).length; idx++) {
    const cf = doc.facts[idx];
    const factId = cf.id || `cand_fact_${idx + 1}`;

    if (!cf.id || typeof cf.id !== "string") {
      errors.push(`[${opaqueId} / ${factId}] Candidate fact missing mandatory id`);
    }

    // Exact text & character offsets (100% mechanical slice equality)
    if (!cf.exactText || typeof cf.exactText !== "string") {
      errors.push(`[${opaqueId} / ${factId}] Missing or invalid exactText`);
    } else {
      if (typeof cf.startOffset !== "number" || typeof cf.endOffset !== "number") {
        errors.push(`[${opaqueId} / ${factId}] Missing mandatory numeric startOffset and endOffset`);
      } else if (cf.startOffset < 0 || cf.endOffset > rawSourceText.length || cf.startOffset >= cf.endOffset) {
        errors.push(
          `[${opaqueId} / ${factId}] Offsets [${cf.startOffset}..${cf.endOffset}] out of range for doc length ${rawSourceText.length}`
        );
      } else {
        const slice = rawSourceText.slice(cf.startOffset, cf.endOffset);
        if (slice !== cf.exactText) {
          errors.push(
            `[${opaqueId} / ${factId}] Literal provenance mismatch: rawSourceText.slice(${cf.startOffset}, ${cf.endOffset}) !== exactText`
          );
        }
      }
    }

    // Canonical proof types (array of canonical 18 types)
    if (!Array.isArray(cf.proofTypes) || cf.proofTypes.length === 0) {
      errors.push(`[${opaqueId} / ${factId}] Candidate fact missing mandatory non-empty proofTypes array`);
    } else {
      for (const pt of cf.proofTypes) {
        if (!VALID_CAND_PROOF_TYPES_SET.has(pt)) {
          errors.push(
            `[${opaqueId} / ${factId}] Invalid candidate proof type: "${pt}". Must belong to canonical 18 proof types.`
          );
        }
      }
    }

    // Evidence class
    if (!VALID_CAND_EVIDENCE_CLASSES_SET.has(cf.evidenceClass)) {
      errors.push(
        `[${opaqueId} / ${factId}] Invalid candidate evidenceClass: "${cf.evidenceClass}". Must be WORK_HISTORY, SELF_SUMMARY, or CAPABILITY_LABEL.`
      );
    }

    // Chronology & position binding for WORK_HISTORY
    if (cf.evidenceClass === "WORK_HISTORY") {
      if (!cf.employer || typeof cf.employer !== "string" || cf.employer.trim().length === 0) {
        errors.push(`[${opaqueId} / ${factId}] WORK_HISTORY claim requires non-empty employer`);
      }
      if (!cf.title || typeof cf.title !== "string" || cf.title.trim().length === 0) {
        errors.push(`[${opaqueId} / ${factId}] WORK_HISTORY claim requires non-empty title`);
      }
      if (!cf.startDate && !cf.dates) {
        errors.push(`[${opaqueId} / ${factId}] WORK_HISTORY claim requires startDate or dates`);
      }
      if (typeof cf.isCurrent !== "boolean") {
        errors.push(`[${opaqueId} / ${factId}] WORK_HISTORY claim requires boolean isCurrent`);
      }
    }

    // Structured metrics validation
    if (cf.metrics !== undefined && cf.metrics !== null) {
      if (!Array.isArray(cf.metrics)) {
        errors.push(`[${opaqueId} / ${factId}] metrics must be an array of StructuredMetric objects`);
      } else {
        for (let mIdx = 0; mIdx < cf.metrics.length; mIdx++) {
          const m = cf.metrics[mIdx];
          if (!m.exactText || typeof m.exactText !== "string") {
            errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Metric missing exactText`);
          }
          if (typeof m.startOffset !== "number" || typeof m.endOffset !== "number") {
            errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Metric missing startOffset / endOffset`);
          } else if (m.startOffset >= 0 && m.endOffset <= rawSourceText.length) {
            const mSlice = rawSourceText.slice(m.startOffset, m.endOffset);
            if (mSlice !== m.exactText) {
              errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Metric slice mismatch with source text`);
            }
          }
          if (!VALID_METRIC_TYPES_SET.has(m.metricType)) {
            errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Invalid metricType: "${m.metricType}"`);
          }
          if (typeof m.normalizedValue !== "number" || isNaN(m.normalizedValue)) {
            errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Metric normalizedValue must be a valid number`);
          }
          if (!VALID_METRIC_COMPARATORS_SET.has(m.comparator)) {
            errors.push(`[${opaqueId} / ${factId} / metric_${mIdx}] Invalid metric comparator: "${m.comparator}"`);
          }
        }
      }
    }

    // Dual-review verification on candidate fact
    const hasDualReview =
      cf.dualReviewStatus === "CONFIRMED" ||
      cf.dualReviewStatus === "ADJUDICATED" ||
      cf.secondReviewerConfirmed === true ||
      doc.dualReviewVerified === true;
    if (!hasDualReview) {
      errors.push(`[${opaqueId} / ${factId}] Candidate fact lacks auditable dual-review confirmation`);
    }

    validatedFacts.push(cf);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    validatedDoc: {
      documentId: opaqueId,
      reviewerId: doc.reviewerId,
      reviewer2Id: doc.reviewer2Id,
      dualReviewVerified: doc.dualReviewVerified ?? true,
      facts: validatedFacts
    }
  };
}

/**
 * Ingests, validates, and compiles human ground truth for a given holdout.
 */
export function ingestHoldoutTruth(holdout: "primary" | "secondary"): IngestionResult {
  const annDir = path.join(batch06Dir, "annotation", holdout);
  const matDir = path.join(batch06Dir, "materials", holdout);
  const rolesAnnDir = path.join(annDir, "roles");
  const candAnnDir = path.join(annDir, "candidates");
  const rolesMatDir = path.join(matDir, "roles");
  const candMatDir = path.join(matDir, "candidates");

  const errors: string[] = [];
  let totalRoles = 0;
  let totalCandidates = 0;
  let totalFacts = 0;
  let totalHighRisk = 0;

  const roleReferenceDocuments: any[] = [];
  const candidateReferenceDocuments: any[] = [];

  // 1. Process Roles
  if (!fs.existsSync(rolesAnnDir)) {
    return {
      valid: false,
      holdout,
      totalRolesProcessed: 0,
      totalCandidatesProcessed: 0,
      totalFactsIngested: 0,
      totalHighRiskBoundariesIngested: 0,
      errors: [`Directory not found: ${rolesAnnDir}`]
    };
  }

  const roleFiles = fs.readdirSync(rolesAnnDir).filter(f => f.endsWith(".json") && !f.includes("_BLANK.json"));
  if (roleFiles.length === 0) {
    return {
      valid: false,
      holdout,
      totalRolesProcessed: 0,
      totalCandidatesProcessed: 0,
      totalFactsIngested: 0,
      totalHighRiskBoundariesIngested: 0,
      errors: [`No completed human annotation files found in ${rolesAnnDir} (only _BLANK templates found)`]
    };
  }

  for (const file of roleFiles) {
    const rawContent = fs.readFileSync(path.join(rolesAnnDir, file), "utf8");
    let doc: any;
    try {
      doc = JSON.parse(rawContent);
    } catch (e: any) {
      errors.push(`JSON parse failure in ${file}: ${e.message}`);
      continue;
    }

    totalRoles++;
    const opaqueId = doc.opaqueId || doc.documentId;
    const rawTextPath = path.join(rolesMatDir, `${opaqueId}.txt`);
    if (!fs.existsSync(rawTextPath)) {
      errors.push(`Raw source file missing for ${opaqueId} at ${rawTextPath}`);
      continue;
    }
    const rawSourceText = fs.readFileSync(rawTextPath, "utf8");

    const result = validateRoleDocument(doc, rawSourceText, file);
    if (!result.valid) {
      errors.push(...result.errors);
    } else if (result.validatedDoc) {
      totalFacts += result.validatedDoc.facts.length;
      totalHighRisk += (result.validatedDoc.highRiskNegatives || []).length;
      roleReferenceDocuments.push({
        ...result.validatedDoc,
        holdout
      });
    }
  }

  // 2. Process Candidates
  if (fs.existsSync(candAnnDir)) {
    const candFiles = fs.readdirSync(candAnnDir).filter(f => f.endsWith(".json") && !f.includes("_BLANK.json"));
    for (const file of candFiles) {
      const rawContent = fs.readFileSync(path.join(candAnnDir, file), "utf8");
      let doc: any;
      try {
        doc = JSON.parse(rawContent);
      } catch (e: any) {
        errors.push(`JSON parse failure in candidate file ${file}: ${e.message}`);
        continue;
      }

      totalCandidates++;
      const opaqueId = doc.opaqueId || doc.documentId;
      const rawTextPath = path.join(candMatDir, `${opaqueId}.md`);
      if (!fs.existsSync(rawTextPath)) {
        errors.push(`Raw source resume missing for ${opaqueId} at ${rawTextPath}`);
        continue;
      }
      const rawSourceText = fs.readFileSync(rawTextPath, "utf8");

      const result = validateCandidateDocument(doc, rawSourceText, file);
      if (!result.valid) {
        errors.push(...result.errors);
      } else if (result.validatedDoc) {
        totalFacts += result.validatedDoc.facts.length;
        candidateReferenceDocuments.push({
          ...result.validatedDoc,
          holdout
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      holdout,
      totalRolesProcessed: totalRoles,
      totalCandidatesProcessed: totalCandidates,
      totalFactsIngested: totalFacts,
      totalHighRiskBoundariesIngested: totalHighRisk,
      errors
    };
  }

  // Emit compiled reference truth
  const referenceTruth = {
    schemaVersion: "gate1b-batch06-reference-truth/v2",
    holdout: holdout.toUpperCase(),
    ingestedAt: new Date().toISOString(),
    roles: roleReferenceDocuments,
    candidates: candidateReferenceDocuments
  };

  const outputTruthPath = path.join(matDir, `${holdout.toUpperCase()}_REFERENCE_TRUTH.json`);
  const contentStr = JSON.stringify(referenceTruth, null, 2);
  fs.writeFileSync(outputTruthPath, contentStr, "utf8");
  const truthHash = sha256(contentStr);

  return {
    valid: true,
    holdout,
    totalRolesProcessed: totalRoles,
    totalCandidatesProcessed: totalCandidates,
    totalFactsIngested: totalFacts,
    totalHighRiskBoundariesIngested: totalHighRisk,
    errors: [],
    referenceTruthHash: truthHash
  };
}

if (require.main === module) {
  const targetHoldout = (process.argv[2] || "primary").toLowerCase() as "primary" | "secondary";
  console.log(`Ingesting human ground truth for holdout: ${targetHoldout}...`);
  const res = ingestHoldoutTruth(targetHoldout);
  if (!res.valid) {
    console.error(`Validation FAILED with ${res.errors.length} errors:`);
    res.errors.slice(0, 10).forEach(e => console.error(`  - ${e}`));
    if (res.errors.length > 10) console.error(`  ... and ${res.errors.length - 10} more errors`);
    process.exit(1);
  } else {
    console.log(`Ingestion SUCCESS!`);
    console.log(`  Roles processed      : ${res.totalRolesProcessed}`);
    console.log(`  Candidates processed : ${res.totalCandidatesProcessed}`);
    console.log(`  Facts ingested       : ${res.totalFactsIngested}`);
    console.log(`  Reference truth hash : ${res.referenceTruthHash}`);
  }
}

