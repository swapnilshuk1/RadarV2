/**
 * canonical_identity.ts
 * 
 * Phase M4.2: Canonical Acquisition Identity & Versioning
 * 
 * Defines deterministic hashing implementations for global canonical opportunities
 * and their material content versions.
 */

import {
  canonicalNormalize,
  computeDeterministicHash,
} from "@/lib/ontology/compiler/OntologyCompiler";

export interface SourceIdentity {
  source: string;
  sourceJobId: string;
}

/**
 * 1. Canonical Opportunity Identity
 * canonical_job_id = SHA256(canonical serialization of source identity)
 * 
 * Critically: Does NOT include title, company, location, or content.
 */
export function computeCanonicalJobId(identity: SourceIdentity): string {
  const normalized = canonicalNormalize({
    source: identity.source.trim(),
    sourceJobId: identity.sourceJobId.trim()
  });
  return computeDeterministicHash(normalized);
}

export interface MaterialContent {
  title: string;
  companyName: string | null;
  location: string | null;
  employmentType: string | null;
  rawContent: string;
}

/**
 * 2. Material Content Fingerprint
 * content_hash = SHA256(canonical serialization of material job fields)
 */
export function computeContentHash(content: MaterialContent): string {
  const normalized = canonicalNormalize({
    title: content.title.trim(),
    companyName: content.companyName?.trim() ?? null,
    location: content.location?.trim() ?? null,
    employmentType: content.employmentType?.trim() ?? null,
    rawContent: content.rawContent.trim()
  });
  return computeDeterministicHash(normalized);
}

/**
 * 3. Opportunity Version
 * opportunity_version = SHA256(canonical serialization of canonical_job_id + content_hash)
 * 
 * This is a deterministic version identity, not a random ULID.
 */
export function computeOpportunityVersionId(canonicalJobId: string, contentHash: string): string {
  const normalized = canonicalNormalize({
    canonicalJobId: canonicalJobId.trim(),
    contentHash: contentHash.trim()
  });
  return computeDeterministicHash(normalized);
}
