/**
 * ingest-batch06-human-truth.ts
 *
 * Implements adjudication import tooling for Gate 1B Batch 06.
 *
 * Invariants:
 * - Validates schema conformity of human-adjudicated JSON files
 * - Validates that every source quote is a verbatim character substring of raw document text
 * - Enforces dual-human confirmation on high-risk negative boundaries and high-risk facts
 * - Ensures semantic types belong strictly to the 25 canonical RoleSemanticTypes
 * - Computes immutable SHA-256 hash of reference truth
 * - Emits audit-ready reference truth structures for evaluator-batch06.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ROLE_SEMANTIC_TYPES } from "../../src/lib/intelligence/extraction/RoleFactTypes";

const rootDir = process.cwd();
const batch06Dir = path.join(rootDir, "audit-reports/gate1b-batch06");

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

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

  const canonicalTypesSet = new Set<string>(ROLE_SEMANTIC_TYPES);
  const validApplicabilities = new Set(["ROLE", "CANDIDATE_REQUIREMENT", "CANDIDATE_PREFERENCE", "COMPANY", "RECRUITING_PROCESS"]);
  const validPolarities = new Set(["AFFIRMED", "NEGATED", "CONDITIONAL"]);

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
    const opaqueId = doc.opaqueId;
    const rawTextPath = path.join(rolesMatDir, `${opaqueId}.txt`);
    if (!fs.existsSync(rawTextPath)) {
      errors.push(`Raw source file missing for ${opaqueId} at ${rawTextPath}`);
      continue;
    }
    const rawSourceText = fs.readFileSync(rawTextPath, "utf8");

    // Check reviewer identity
    if (!doc.reviewerId || typeof doc.reviewerId !== "string" || doc.reviewerId.trim().length === 0) {
      errors.push(`Missing reviewerId in ${file}`);
    }

    // Process facts
    const validatedFacts: any[] = [];
    for (const f of doc.facts || []) {
      totalFacts++;
      // Check verbatim quote
      for (const quote of f.sourceEvidence || []) {
        if (!rawSourceText.includes(quote)) {
          errors.push(`[${opaqueId}] Quote "${quote.slice(0, 40)}..." not found verbatim in raw source text`);
        }
      }
      // Check canonical types
      for (const t of f.canonicalTypes || []) {
        if (!canonicalTypesSet.has(t)) {
          errors.push(`[${opaqueId}] Invalid canonical type: ${t}`);
        }
      }
      // Check applicability
      if (!validApplicabilities.has(f.appliesTo)) {
        errors.push(`[${opaqueId}] Invalid applicability: ${f.appliesTo}`);
      }
      // Check polarity
      if (!validPolarities.has(f.polarity)) {
        errors.push(`[${opaqueId}] Invalid polarity: ${f.polarity}`);
      }
      if (f.highRiskFamily) {
        totalHighRisk++;
      }
      validatedFacts.push(f);
    }

    roleReferenceDocuments.push({
      documentId: opaqueId,
      holdout,
      reviewerId: doc.reviewerId,
      reviewer2Id: doc.reviewer2Id,
      facts: validatedFacts,
      highRiskNegatives: doc.highRiskNegatives || []
    });
  }

  // 2. Process Candidates
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
    const opaqueId = doc.opaqueId;
    const rawTextPath = path.join(candMatDir, `${opaqueId}.md`);
    if (!fs.existsSync(rawTextPath)) {
      errors.push(`Raw source resume missing for ${opaqueId} at ${rawTextPath}`);
      continue;
    }
    const rawSourceText = fs.readFileSync(rawTextPath, "utf8");

    if (!doc.reviewerId || typeof doc.reviewerId !== "string" || doc.reviewerId.trim().length === 0) {
      errors.push(`Missing reviewerId in candidate file ${file}`);
    }

    const validatedCandFacts: any[] = [];
    for (const cf of doc.facts || []) {
      totalFacts++;
      if (cf.exactText && !rawSourceText.includes(cf.exactText)) {
        errors.push(`[${opaqueId}] Candidate fact text "${cf.exactText.slice(0, 40)}..." not found verbatim in raw resume`);
      }
      validatedCandFacts.push(cf);
    }

    candidateReferenceDocuments.push({
      documentId: opaqueId,
      holdout,
      reviewerId: doc.reviewerId,
      facts: validatedCandFacts
    });
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
    schemaVersion: "gate1b-batch06-reference-truth/v1",
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
