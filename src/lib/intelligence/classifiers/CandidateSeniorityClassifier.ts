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
    const isCSuite = /\b(cmo|cgo|cro|coo|ceo|cfo|chief\s+\w+(?:\s+\w+)?\s+officer)\b/.test(tLower);
    const contextLower = text.toLowerCase();
    // Do not promote generic leadership, board exposure, or target language to
    // attained C-suite seniority. Only an explicit attained C-suite fact counts.
    const hasAttainedCSuiteFact =
      /\b(?:currently|current|serving\s+as|served\s+as|appointed\s+as|held\s+the\s+(?:role|position)\s+of)\b[^.\n]{0,80}\b(?:chief|cmo|cgo|cro|coo|ceo|cfo)\b/.test(contextLower) ||
      /\b(?:is|was|served\s+as|appointed\s+as|held)\s+(?:an?\s+)?c[\s-]?suite\b/.test(contextLower);

    if (isCSuite || hasAttainedCSuiteFact) {
      evidenceIds.push(isCSuite ? `c_suite:title:${title.trim()}` : "c_suite:attained_fact");
      return { value: "C_SUITE", evidenceIds, confidence: 0.95 };
    }

    // VP-level detection
    const isVP = /\b(vp|vice\s+president|svp|senior\s+vice\s+president|avp|assistant\s+vice\s+president)\b/.test(tLower);
    const hasVPResponsibilities = /\bhead\s+of\b|\bcountry\s+head\b|\bhead\s+-\b/.test(tLower);

    if (isVP || hasVPResponsibilities) {
      evidenceIds.push(isVP ? `vp_functional:title:${title.trim()}` : "vp_functional:head_title");
      return { value: "VP_FUNCTIONAL", evidenceIds, confidence: 0.9 };
    }

    // Director-level detection
    const isDirector = /\b(director|senior\s+director|associate\s+director)\b/.test(tLower);
    const hasDirectorScope = /\bhead\s+of\b|\bcoordinator\b|\bmanager\b/.test(tLower);

    if (isDirector || hasDirectorScope) {
      evidenceIds.push(isDirector ? `director:title:${title.trim()}` : "director:scope_title");
      return { value: "DIRECTOR", evidenceIds, confidence: 0.85 };
    }

    // Fallback: unknown seniority
    evidenceIds.push("unknown:no_seniority_signals");
    return { value: "UNKNOWN", evidenceIds, confidence: 0.5 };
  }
}
