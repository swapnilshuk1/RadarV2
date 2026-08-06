// src/lib/intelligence/ekb/ExecutiveKnowledgeNormalizationPipeline.ts

import { EKBCompatibilityAdapter } from "./EKBCompatibilityAdapter";
import { unwrapEvidenceValue } from "../editorial/SemanticNaturalLanguageResolver";

export interface NormalizedCapability {
  id: string;
  label: string;
  confidence: number;
  evidence: string[];
  source: string;
}

export class ExecutiveKnowledgeNormalizationPipeline {
  /**
   * Executive Knowledge Normalization Pipeline
   * 
   * Converts raw, unstructured job description dimensions into canonical, 
   * ontology-mapped Executive Capability objects. Implements verb-stripping,
   * semantic concept mapping, synonymization, and importance ranking.
   */
  public static normalize(dimensions: any[]): NormalizedCapability[] {
    const rawCaps: Array<{ value: string; source: string }> = [];

    // 1. Gather all raw terms with their dimension sources
    for (const d of dimensions) {
      if (!d || !d.jdEvidence?.value) continue;
      const val = unwrapEvidenceValue(d.jdEvidence.value);
      if (val && typeof val === "string") {
        rawCaps.push({ value: val, source: d.key || "functionalScope" });
      }
    }

    const resolvedSet = new Map<string, NormalizedCapability>();

    // Regex for stripping leading action verbs and prepositions
    const actionVerbsRegex = /^\s*(?:lead|champion|coordinate|support|partner with|deliver|execute|own|manage|drive|build and execute|oversee|directing|overseeing|to drive|with a focus on|responsible for|focus on|driving|scaling|scale)\s+/i;

    for (const capItem of rawCaps) {
      // Split raw strings into individual sub-components
      const parts = capItem.value.split(/[,;&]|\s+and\s+/i);

      for (const part of parts) {
        const text = part.trim();
        if (text.length < 3) continue;

        // 2. Linguistic Classification & Noun Phrase Extraction
        // Strip out the action verbs to find the raw noun phrase (the 'what', not the 'how')
        const cleanNounPhrase = text
          .replace(actionVerbsRegex, "")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanNounPhrase.length < 3) continue;

        const lowerPhrase = cleanNounPhrase.toLowerCase();

        // 3. Multi-Stage Semantic Mapping (Ontology Match -> High-Tier Catalog Match -> Fallback)
        let matchedId = `cap_${lowerPhrase.replace(/[^a-z0-9]/g, "_")}`;
        let matchedLabel = "";
        let confidence = 0.50;

        // Stage 3A: Search the 245-line Executive Semantic Graph (EKB/executive_ontology.json)
        const exactMatch = EKBCompatibilityAdapter.resolveCapability(cleanNounPhrase);
        if (exactMatch && exactMatch.id && !exactMatch.id.startsWith("syn_")) {
          matchedId = exactMatch.id;
          matchedLabel = exactMatch.name;
          confidence = 0.95;
        }

        // Stage 3B: Canonical Ontology Mapping for key high-importance dimensions
        if (!matchedLabel) {
          if (lowerPhrase.includes("crm") || lowerPhrase.includes("retention") || lowerPhrase.includes("customer lifecycle") || lowerPhrase.includes("salesforce")) {
            matchedId = "cap_crm_strategy";
            matchedLabel = "CRM & Customer Retention Strategy";
            confidence = 0.90;
          } else if (lowerPhrase.includes("growth") || lowerPhrase.includes("scale") || lowerPhrase.includes("commercial expansion") || lowerPhrase.includes("gtm") || lowerPhrase.includes("go-to-market")) {
            matchedId = "cap_executive_growth_scale";
            matchedLabel = "Executive Growth & Scale Mandate";
            confidence = 0.90;
          } else if (lowerPhrase.includes("turnaround") || lowerPhrase.includes("stabiliz") || lowerPhrase.includes("pivot") || lowerPhrase.includes("restructuring") || lowerPhrase.includes("ebitda")) {
            matchedId = "cap_business_turnaround";
            matchedLabel = "Corporate Turnaround & Restructuring";
            confidence = 0.90;
          } else if (lowerPhrase.includes("p&l") || lowerPhrase.includes("pnl") || lowerPhrase.includes("budget") || lowerPhrase.includes("financial") || lowerPhrase.includes("revenue target")) {
            matchedId = "cap_enterprise_financial_stewardship";
            matchedLabel = "Enterprise Financial Stewardship";
            confidence = 0.90;
          } else if (lowerPhrase.includes("greenfield") || lowerPhrase.includes("builder") || lowerPhrase.includes("modernization") || lowerPhrase.includes("transformation")) {
            matchedId = "cap_high_growth_builder";
            matchedLabel = "Greenfield Builder";
            confidence = 0.90;
          }
        }

        // Stage 3C: High-Tier Executive Catalog Mapping (Synonymization catalog)
        if (!matchedLabel) {
          if (lowerPhrase.includes("performance marketing") || lowerPhrase.includes("paid media") || lowerPhrase.includes("ads") || lowerPhrase.includes("marketing")) {
            matchedId = "cap_perf_mkt";
            matchedLabel = "Performance Marketing";
            confidence = 0.85;
          } else if (lowerPhrase.includes("acquisition") || lowerPhrase.includes("demand") || lowerPhrase.includes("lead gen")) {
            matchedId = "cap_growth_acq";
            matchedLabel = "Customer Acquisition";
            confidence = 0.85;
          } else if (lowerPhrase.includes("digital") || lowerPhrase.includes("transformation") || lowerPhrase.includes("automation")) {
            matchedId = "cap_digital_transformation";
            matchedLabel = "Digital Transformation";
            confidence = 0.80;
          } else if (lowerPhrase.includes("delivery") || lowerPhrase.includes("execution") || lowerPhrase.includes("agile") || lowerPhrase.includes("project") || lowerPhrase.includes("operations")) {
            matchedId = "cap_operational_excellence";
            matchedLabel = "Operational Excellence";
            confidence = 0.80;
          } else if (lowerPhrase.includes("partner") || lowerPhrase.includes("channel") || lowerPhrase.includes("alliances")) {
            matchedId = "cap_strategic_partnerships";
            matchedLabel = "Strategic Partnerships";
            confidence = 0.80;
          } else if (lowerPhrase.includes("strategy") || lowerPhrase.includes("strategic")) {
            matchedId = "cap_sales_gtm";
            matchedLabel = "Go-To-Market Strategy";
            confidence = 0.80;
          }
        }

        // Stage 3D: High-Fidelity Noun Phrase Fallback
        if (!matchedLabel) {
          const wordCount = cleanNounPhrase.split(" ").length;
          // Filter out excessively long responsibility sentences (>5 words) to maintain high-fidelity representations
          if (wordCount <= 5) {
            matchedLabel = cleanNounPhrase
              .split(" ")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(" ");
            confidence = 0.60;
          }
        }

        // 4. Merge overlapping/duplicate capabilities and track evidence
        if (matchedLabel) {
          const existing = resolvedSet.get(matchedLabel);
          if (existing) {
            if (!existing.evidence.includes(text)) {
              existing.evidence.push(text);
            }
            existing.confidence = Math.max(existing.confidence, confidence);
          } else {
            resolvedSet.set(matchedLabel, {
              id: matchedId,
              label: matchedLabel,
              confidence,
              evidence: [text],
              source: capItem.source,
            });
          }
        }
      }
    }

    // 5. Importance Ranking
    // Priority order:
    // 1. Core Ontology Matches (confidence >= 0.90)
    // 2. High-Tier Catalog Matches (confidence >= 0.80)
    // 3. Fallback Clean Noun Phrases (confidence >= 0.60)
    return Array.from(resolvedSet.values())
      .sort((a, b) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        return b.evidence.length - a.evidence.length;
      })
      .slice(0, 3);
  }
}
