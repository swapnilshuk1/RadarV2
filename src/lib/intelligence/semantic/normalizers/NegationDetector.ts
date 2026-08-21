/**
 * src/lib/intelligence/semantic/normalizers/NegationDetector.ts
 *
 * Syntax and clause-aware negation & scope dilution detector.
 *
 * Distinguishes:
 * - Direct ownership: "Full P&L ownership" -> negated=false, strength=DIRECT_OWNERSHIP
 * - Explicit negation: "No direct P&L responsibility", "Never had P&L" -> negated=true, strength=EXCLUDED
 * - Contributor / Diluted scope: "Supported the P&L owner", "Assisted on budget" -> negated=false, strength=CONTRIBUTOR
 * - Stakeholder / Collaboration: "Worked with the P&L leader", "Reported to P&L owner" -> negated=false, strength=STAKEHOLDER
 */

import type { EvidenceStrength } from "../types";

export interface NegationDetectionResult {
  readonly negated: boolean;
  readonly evidenceStrength: EvidenceStrength;
  readonly triggerPhrase?: string;
  readonly reason: string;
}

const EXPLICIT_NEGATION_TRIGGERS = [
  /\bno\s+(?:direct|indirect|actual|active|formal)?\s*(?:p&l|ownership|responsibility|experience|reports|accountability)\b/i,
  /\bno\s+(?:direct|indirect|actual|active)\b/i,
  /\bnot\s+(?:responsible|owning|held|having|accountable|leading)\b/i,
  /\bdoes\s+not\s+(?:own|have|manage|lead)\b/i,
  /\bdid\s+not\s+(?:own|have|manage|lead)\b/i,
  /\bnever\s+(?:had|owned|held|managed)\b/i,
  /\bwithout\s+(?:direct|any|formal)?\s*(?:p&l|ownership|responsibility|experience|accountability)\b/i,
  /\black(?:s|ed|ing)?\s+(?:direct|any|formal)?\s*(?:p&l|ownership|responsibility|experience|accountability)\b/i,
  /\bzero\s+(?:direct|indirect|actual|formal)?\s*(?:p&l|ownership|responsibility|experience|reports|accountability)\b/i,
  /\bnon[- ](?:executive|commercial|p&l)\b/i,
  /\bneither\b/i,
];

const CONTRIBUTOR_TRIGGERS = [
  /\bsupport(?:ed|ing|s)?\s+(?:the|with|on)\b/i,
  /\bassist(?:ed|ing|s)?\s+(?:the|with|on)\b/i,
  /\bparticipat(?:ed|ing|s)?\s+in\b/i,
  /\bcontribut(?:ed|ing|s)?\s+to\b/i,
  /\bhelped\s+(?:with|to|drive)\b/i,
  /\bprovided\s+(?:support|analysis|inputs?)\s+(?:for|to)\b/i,
];

const STAKEHOLDER_TRIGGERS = [
  /\bworked\s+(?:closely\s+)?with\s+(?:the)?\b/i,
  /\breport(?:ed|ing|s)?\s+(?:directly\s+)?to\s+(?:the)?\b/i,
  /\bpartner(?:ed|ing|s)?\s+with\s+(?:the)?\b/i,
  /\bcollaborat(?:ed|ing|s)?\s+with\s+(?:the)?\b/i,
  /\bliaised\s+with\b/i,
  /\binterfaced\s+with\b/i,
];

const CLAUSE_BOUNDARIES = /[;!?\.]|\b(?:but|however|although|whereas|except|while)\b/i;

export class NegationDetector {
  /**
   * Analyzes a context snippet around a concept to determine negation or scope dilution.
   */
  public static analyze(context: string, conceptPhrase?: string): NegationDetectionResult {
    const raw = context.trim();
    if (!raw) {
      return { negated: false, evidenceStrength: "DIRECT_OWNERSHIP", reason: "Empty context default" };
    }

    // Isolate relevant clause if conceptPhrase is provided
    let targetClause = raw;
    if (conceptPhrase) {
      const idx = raw.toLowerCase().indexOf(conceptPhrase.toLowerCase());
      if (idx !== -1) {
        const start = Math.max(0, idx - 120);
        const end = Math.min(raw.length, idx + conceptPhrase.length + 80);
        const snippet = raw.substring(start, end);
        
        const clauses = snippet.split(CLAUSE_BOUNDARIES);
        const matchingClause = clauses.find(c => c.toLowerCase().includes(conceptPhrase.toLowerCase()));
        if (matchingClause) {
          targetClause = matchingClause.trim();
        }
      }
    }

    const textLower = targetClause.toLowerCase();

    // 1. Check for Explicit Negation
    for (const regex of EXPLICIT_NEGATION_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          negated: true,
          evidenceStrength: "EXCLUDED",
          triggerPhrase: match[0].trim(),
          reason: `Explicit negation detected via trigger: "${match[0].trim()}"`
        };
      }
    }

    // 2. Check for Contributor / Diluted Scope
    for (const regex of CONTRIBUTOR_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          negated: false,
          evidenceStrength: "CONTRIBUTOR",
          triggerPhrase: match[0].trim(),
          reason: `Contributor / support scope detected via trigger: "${match[0].trim()}"`
        };
      }
    }

    // 3. Check for Stakeholder / Collaboration Scope
    for (const regex of STAKEHOLDER_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          negated: false,
          evidenceStrength: "STAKEHOLDER",
          triggerPhrase: match[0].trim(),
          reason: `Stakeholder / reporting line scope detected via trigger: "${match[0].trim()}"`
        };
      }
    }

    // 4. Default to Direct Ownership
    return {
      negated: false,
      evidenceStrength: "DIRECT_OWNERSHIP",
      reason: "No negation or dilution triggers detected in clause"
    };
  }
}
