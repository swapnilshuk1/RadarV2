// src/lib/intelligence/classifiers/CandidateSeniorityClassifier.ts

import { ClassifierResult, CandidateSeniorityLevel } from "../../domain/semantic";
import { SeniorityResolver } from "../semantic/resolvers/SeniorityResolver";

/**
 * P0-E: Candidate Seniority Classifier
 *
 * This classifier determines the candidate's career seniority level based on their title
 * and profile information. It is DISTINCT from OperatingLevelClassifier.
 *
 * OperatingLevel = strategic altitude / operating mode
 * CandidateSeniorityLevel = organizational rank / career stage
 *
 * These are independent dimensions and must not be derived from one another.
 */
export class CandidateSeniorityClassifier {
  /**
   * Classifies candidate seniority based on title and profile text.
   *
   * @param title - The candidate's current title (e.g., "VP Marketing", "Senior Director")
   * @param text - Additional profile text for context
   * @returns ClassifierResult<CandidateSeniorityLevel>
   */
  public static classify(title: string, text: string): ClassifierResult<CandidateSeniorityLevel> {
    const contextLower = text.toLowerCase();
    const evidenceIds: string[] = [];

    // Preserve the attained-fact safeguard: target/aspirational C-suite language
    // must never upgrade the candidate's current rank.
    const hasAttainedCSuiteFact =
      /\b(?:currently|current|serving\s+as|served\s+as|appointed\s+as|held\s+the\s+(?:role|position)\s+of)\b[^.\n]{0,80}\b(?:chief|cmo|cgo|cro|coo|ceo|cfo)\b/.test(contextLower) ||
      /\b(?:is|was|served\s+as|appointed\s+as|held)\s+(?:an?\s+)?c[\s-]?suite\b/.test(contextLower);

    const resolved = SeniorityResolver.resolve(title, text);
    if (resolved.seniorityBand === "C_SUITE" || hasAttainedCSuiteFact) {
      evidenceIds.push(
        resolved.seniorityBand === "C_SUITE"
          ? `c_suite:title:${title.trim()}`
          : "c_suite:attained_fact",
      );
      return { value: "C_SUITE", evidenceIds, confidence: Math.max(resolved.confidence, 0.95) };
    }

    if (resolved.seniorityBand === "VP" || resolved.seniorityBand === "HEAD") {
      evidenceIds.push(`vp_functional:title:${title.trim()}`);
      return { value: "VP_FUNCTIONAL", evidenceIds, confidence: resolved.confidence };
    }

    if (resolved.seniorityBand === "DIRECTOR") {
      evidenceIds.push(`director:title:${title.trim()}`);
      return { value: "DIRECTOR", evidenceIds, confidence: resolved.confidence };
    }

    evidenceIds.push("unknown:no_seniority_signals");
    return { value: "UNKNOWN", evidenceIds, confidence: resolved.confidence };
  }
}
