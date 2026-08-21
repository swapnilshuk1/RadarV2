/**
 * src/lib/intelligence/semantic/SemanticResolutionEngine.ts
 *
 * RADAR V4 Central Pure Semantic Resolution Engine.
 *
 * Invariant Rules:
 * 1. Pure & Deterministic: Operates entirely in-memory with zero I/O or network requests.
 * 2. Non-Scoring: Resolves meaning (evidence objects), never calculates score points or alters policy thresholds.
 * 3. Directionality: Preserves strict non-symmetric containment, entity hierarchies, and metric relations.
 * 4. Explainable: Retains source phrase, context, relationship, confidence, temporal state, and negation.
 */

import type {
  CanonicalSemanticEvidence,
  CompositionalEvidenceResult,
  FinancialScopeResolutionResult,
  GeographyResolutionResult,
  OrganizationResolutionResult,
  SeniorityResolutionResult,
} from "./types";
import { CapabilityResolver } from "./resolvers/CapabilityResolver";
import { CommercialScopeResolver } from "./resolvers/CommercialScopeResolver";
import { SeniorityResolver } from "./resolvers/SeniorityResolver";
import { GeographyResolver } from "./resolvers/GeographyResolver";
import { OrganizationResolver } from "./resolvers/OrganizationResolver";
import { CompositionalExtractor } from "./resolvers/CompositionalExtractor";
import { NegationDetector, type NegationDetectionResult } from "./normalizers/NegationDetector";
import { TemporalParser, type TemporalParsingResult } from "./normalizers/TemporalParser";
import { ContextualDisambiguator, type DisambiguationResult } from "./normalizers/ContextualDisambiguator";

export class SemanticResolutionEngine {
  public static readonly VERSION = "v3_semantic_v1";

  /**
   * Resolves a capability phrase against an optional requirement target.
   */
  public static resolveCapability(
    inputPhrase: string,
    targetRequirement?: string,
    context: string = ""
  ): CanonicalSemanticEvidence | null {
    return CapabilityResolver.resolve(inputPhrase, targetRequirement, context);
  }

  /**
   * Resolves a financial / commercial scope expression into structured attributes.
   */
  public static resolveCommercialScope(
    rawPhrase: string,
    context: string = ""
  ): FinancialScopeResolutionResult {
    return CommercialScopeResolver.resolve(rawPhrase, context);
  }

  /**
   * Resolves a seniority title / designation into hierarchical attributes.
   */
  public static resolveSeniority(
    rawTitle: string,
    context: string = ""
  ): SeniorityResolutionResult {
    return SeniorityResolver.resolve(rawTitle, context);
  }

  /**
   * Resolves a geography match with directional hierarchy enforcement.
   */
  public static resolveGeography(
    sourceLocation: string,
    targetLocation?: string,
    context: string = ""
  ): GeographyResolutionResult {
    return GeographyResolver.resolve(sourceLocation, targetLocation, context);
  }

  /**
   * Resolves an organization / brand entity with directional parent/subsidiary hierarchy.
   */
  public static resolveOrganization(
    rawOrg: string,
    targetOrg?: string,
    context: string = ""
  ): OrganizationResolutionResult {
    return OrganizationResolver.resolve(rawOrg, targetOrg, context);
  }

  /**
   * Decomposes a compound executive sentence into multiple structured evidence objects.
   */
  public static extractCompositional(rawText: string): CompositionalEvidenceResult {
    return CompositionalExtractor.extract(rawText);
  }

  /**
   * Analyzes context for negation and scope dilution.
   */
  public static detectNegation(context: string, conceptPhrase?: string): NegationDetectionResult {
    return NegationDetector.analyze(context, conceptPhrase);
  }

  /**
   * Analyzes context for temporal state and recency.
   */
  public static parseTemporal(context: string): TemporalParsingResult {
    return TemporalParser.parse(context);
  }

  /**
   * Disambiguates MD acronym.
   */
  public static disambiguateMD(context: string): DisambiguationResult {
    return ContextualDisambiguator.disambiguateMD(context);
  }

  /**
   * Disambiguates GM acronym.
   */
  public static disambiguateGM(context: string): DisambiguationResult {
    return ContextualDisambiguator.disambiguateGM(context);
  }

  /**
   * Disambiguates Brand / Noun collisions.
   */
  public static disambiguateOrganization(orgName: string, context: string): DisambiguationResult {
    return ContextualDisambiguator.disambiguateOrganization(orgName, context);
  }
}
