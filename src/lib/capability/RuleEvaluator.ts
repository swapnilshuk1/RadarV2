/**
 * RuleEvaluator.ts
 *
 * Evaluator for declarative boolean logic (allOf, anyOf, noneOf).
 * Determines rule satisfaction, scores matches, and enforces strict rule-level provenance.
 */
import type { EvidenceReference, SourceDimension } from "../../domain/entities";
import { type RuleCondition, type CompositionalRules } from "../ontology/CapabilityOntology";
import { TechnologyOntology } from "../ontology/TechnologyOntology";
import type { JobSlice } from "./CapabilityEngine";

export interface EvaluationResult {
  matched: boolean;
  score: number; // Continuous score [0-1]
  evidence: EvidenceReference[];
}

export class RuleEvaluator {
  private techOntology = TechnologyOntology.load();

  /**
   * Evaluate composition rules (allOf, anyOf, noneOf) recursively.
   */
  public evaluate(rules: CompositionalRules, job: JobSlice): EvaluationResult {
    const evidence: EvidenceReference[] = [];
    let totalConditions = 0;
    let matchedConditions = 0;

    // 1. Evaluate allOf: Every condition must match
    if (rules.allOf && rules.allOf.length > 0) {
      for (const cond of rules.allOf) {
        totalConditions++;
        const res = this.evaluateCondition(cond, job);
        if (res.matched && res.evidence.length > 0) {
          matchedConditions++;
          evidence.push(...res.evidence);
        } else {
          // If any of allOf fails or lacks evidence, the entire composition fails
          return { matched: false, score: 0, evidence: [] };
        }
      }
    }

    // 2. Evaluate anyOf: At least one condition must match
    if (rules.anyOf && rules.anyOf.length > 0) {
      totalConditions++;
      let anyMatched = false;
      const localEvidence: EvidenceReference[] = [];
      for (const cond of rules.anyOf) {
        const res = this.evaluateCondition(cond, job);
        if (res.matched && res.evidence.length > 0) {
          anyMatched = true;
          localEvidence.push(...res.evidence);
        }
      }
      if (anyMatched) {
        matchedConditions++;
        evidence.push(...localEvidence);
      } else {
        return { matched: false, score: 0, evidence: [] };
      }
    }

    // 3. Evaluate noneOf: No conditions must match
    if (rules.noneOf && rules.noneOf.length > 0) {
      totalConditions++;
      let noneMatched = true;
      for (const cond of rules.noneOf) {
        const res = this.evaluateCondition(cond, job);
        if (res.matched) {
          noneMatched = false;
        }
      }
      if (noneMatched) {
        matchedConditions++;
      } else {
        return { matched: false, score: 0, evidence: [] };
      }
    }

    const matched = totalConditions > 0 && matchedConditions === totalConditions;
    const score = totalConditions > 0 ? matchedConditions / totalConditions : 1.0;

    return {
      matched,
      score,
      evidence,
    };
  }

  /**
   * Evaluates a single rule condition.
   */
  private evaluateCondition(cond: RuleCondition, job: JobSlice): { matched: boolean; evidence: EvidenceReference[] } {
    const dimVal = job.dimensions[cond.dimension];
    if (!dimVal || dimVal.value === undefined || dimVal.value === null) {
      return { matched: false, evidence: [] };
    }

    let valToParse = dimVal.value;

    // Proactively unwrap structural JSON values from modernized extractors
    if (typeof valToParse === "string" && valToParse.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(valToParse);
        if (parsed.value !== undefined && parsed.value !== null) {
          valToParse = parsed.value;
        } else if (parsed.canonicalValue !== undefined && parsed.canonicalValue !== null) {
          valToParse = parsed.canonicalValue;
        } else if (parsed.categories !== undefined && Array.isArray(parsed.categories)) {
          valToParse = parsed.categories;
        }
      } catch {
        // Fall back to original string
      }
    }

    const valuesList: string[] = [];
    if (Array.isArray(valToParse)) {
      valuesList.push(...valToParse.map(v => String(v).trim()));
    } else if (typeof valToParse === "string") {
      if (valToParse.includes(",")) {
        valuesList.push(...valToParse.split(",").map(v => v.trim()));
      } else {
        valuesList.push(valToParse.trim());
      }
    } else if (valToParse !== undefined && valToParse !== null) {
      valuesList.push(String(valToParse).trim());
    }

    const matchedValues = new Set<string>();

    // Filter by categories if technologyStack
    if (cond.dimension === "technologyStack" && cond.categories && cond.categories.length > 0) {
      const lowerCats = cond.categories.map(c => c.toLowerCase());
      for (const val of valuesList) {
        const lookup = this.techOntology.lookup(val);
        if (lookup && lowerCats.includes(lookup.category.toLowerCase())) {
          matchedValues.add(val);
        }
      }
    }

    // Evaluate anyOf
    if (cond.anyOf && cond.anyOf.length > 0) {
      const targets = new Set(cond.anyOf.map(t => t.toLowerCase()));
      for (const val of valuesList) {
        if (targets.has(val.toLowerCase())) {
          matchedValues.add(val);
        }
      }
    }

    // Evaluate allOf
    if (cond.allOf && cond.allOf.length > 0) {
      const targets = new Set(cond.allOf.map(t => t.toLowerCase()));
      const hits = valuesList.filter(val => targets.has(val.toLowerCase()));
      if (hits.length === cond.allOf.length) {
        hits.forEach(h => matchedValues.add(h));
      } else {
        return { matched: false, evidence: [] }; // Failed allOf
      }
    }

    // Evaluate noneOf
    if (cond.noneOf && cond.noneOf.length > 0) {
      const targets = new Set(cond.noneOf.map(t => t.toLowerCase()));
      const hasAny = valuesList.some(val => targets.has(val.toLowerCase()));
      if (hasAny) {
        return { matched: false, evidence: [] }; // Violated noneOf
      }
    }

    const matched = matchedValues.size > 0 || (cond.noneOf && !cond.anyOf && !cond.allOf && valuesList.length > 0);

    if (matched) {
      // Create a premium EvidenceReference with explicit, robust provenance metadata
      const evidenceRef: EvidenceReference = {
        dimension: cond.dimension as SourceDimension,
        quote: dimVal.evidence,
        matchedValue: Array.from(matchedValues).join(", ") || String(dimVal.value),
        confidence: dimVal.confidence ?? 1.0,
      };

      // Invariant: Rule-level evidence must be non-empty and valid
      if (!evidenceRef.quote || evidenceRef.quote.trim().length === 0) {
        return { matched: false, evidence: [] }; // Lacks valid evidence quote
      }

      return { matched: true, evidence: [evidenceRef] };
    }

    return { matched: false, evidence: [] };
  }
}
