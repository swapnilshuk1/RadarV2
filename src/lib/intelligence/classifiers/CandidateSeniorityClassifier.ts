// src/lib/intelligence/classifiers/CandidateSeniorityClassifier.ts

import { ClassifierResult, CandidateSeniorityLevel } from "../../domain/semantic";

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
    const tLower = title.toLowerCase();
    const evidenceIds: string[] = [];

    // C-Suite detection
    const isCSuite = /\b(cmo|cgo|cro|coo|ceo|cfo|chief |chief\s+\w+\s+officer|chief\s+\w+\s+\w+\s+officer)\b/.test(tLower);
    const hasCSuiteKeywords = /\bc\s*-\s*suite\b|\bc\s+level\b|\bboard\s+level\b|\bexecutive\s+team\b|\b leadership\b/.test(tLower + " " + text.toLowerCase());

    if (isCSuite || hasCSuiteKeywords) {
      evidenceIds.push("c_suite:chief_title");
      return { value: "C_SUITE", evidenceIds, confidence: 0.95 };
    }

    // VP-level detection
    const isVP = /\b(vp|vice\s+president|svp|senior\s+vice\s+president|avp|assistant\s+vice\s+president)\b/.test(tLower);
    const hasVPResponsibilities = /\bhead\s+of\b|\bcountry\s+head\b|\bhead\s+-\b|\blead\b/.test(tLower);

    if (isVP || hasVPResponsibilities) {
      evidenceIds.push("vp_functional:vp_title");
      return { value: "VP_FUNCTIONAL", evidenceIds, confidence: 0.9 };
    }

    // Director-level detection
    const isDirector = /\b(director|senior\s+director|associate\s+director)\b/.test(tLower);
    const hasDirectorScope = /\bhead\s+of\b|\bcoordinator\b|\bmanager\b/.test(tLower);

    if (isDirector || hasDirectorScope) {
      evidenceIds.push("director:director_title");
      return { value: "DIRECTOR", evidenceIds, confidence: 0.85 };
    }

    // Fallback: unknown seniority
    evidenceIds.push("unknown:no_seniority_signals");
    return { value: "UNKNOWN", evidenceIds, confidence: 0.5 };
  }
}
