/**
 * RecommendationCache
 * 
 * Implements content-addressed caching of recommendation results.
 * 
 * Hash = sha256(CandidateProfileVersion + ExtractionVersion + RecommendationPolicyVersion)
 * 
 * If unchanged, skip re-evaluation entirely. This ensures:
 * - Idempotent re-runs of the recommendation batch
 * - Scores only change when the inputs actually change
 * - Full audit trail (old assessments are never mutated)
 */

import { createHash } from "crypto";
import type { OpportunityAssessment } from "../../domain/entities";

export interface CacheKey {
  candidateProfileVersion: string;
  extractionVersion: string;        // jobHash from JobSlice
  recommendationPolicyVersion: string;
}

export class RecommendationCache {
  private cache = new Map<string, OpportunityAssessment>();

  /**
   * Derive the canonical cache key from the three versioned inputs.
   * This is the RecommendationHash referenced in the architecture.
   */
  static buildHash(key: CacheKey): string {
    const content = [
      key.candidateProfileVersion,
      key.extractionVersion,
      key.recommendationPolicyVersion,
    ].join("|");

    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Returns a cached assessment if one exists for this exact combination
   * of profile, extraction, and policy versions. Returns undefined if stale
   * or absent, meaning the scorer should run.
   */
  get(key: CacheKey): OpportunityAssessment | undefined {
    return this.cache.get(RecommendationCache.buildHash(key));
  }

  /**
   * Stores an assessment under its cache key. Because assessments are
   * immutable, this is safe to call unconditionally after scoring.
   */
  set(key: CacheKey, assessment: OpportunityAssessment): void {
    this.cache.set(RecommendationCache.buildHash(key), assessment);
  }

  /**
   * Returns true if a cached assessment exists for this key.
   */
  has(key: CacheKey): boolean {
    return this.cache.has(RecommendationCache.buildHash(key));
  }

  /**
   * Returns the number of cached assessments.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear the entire cache. Useful when switching profiles or policies.
   */
  clear(): void {
    this.cache.clear();
  }
}
