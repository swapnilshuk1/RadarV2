import fs from "fs";
import path from "path";
import type { CareerIntent } from "./career-intent";

export interface SearchPlan {
  version: string;
  generatedAt: string;
  candidateIntent: CareerIntent;
  searchHypotheses: Array<{
    name: string;
    description: string;
    queries: string[];
  }>;
  rankedQueries: Array<{
    query: string;
    score: number;
    dimension: string;
    concept: string;
  }>;
}

export class SearchPlanner {
  /**
   * Plans and generates the dynamic Search Plan artifact based on Candidate Career Intent,
   * Functional Taxonomy, and Search Lexicon.
   */
  public static plan(
    intent: CareerIntent,
    taxonomyPath: string,
    lexiconPath: string
  ): SearchPlan {
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf-8"));
    const lexicon = JSON.parse(fs.readFileSync(lexiconPath, "utf-8"));

    const scores: Record<string, number> = {};

    // 1. Compute scores for each lexicon concept based on CareerIntent match vectors
    for (const [dimensionKey, concepts] of Object.entries(lexicon.dimensions)) {
      const conceptMap = concepts as Record<string, string[]>;
      for (const conceptName of Object.keys(conceptMap)) {
        let score = 0;
        const conceptLower = conceptName.toLowerCase();

        // Match against target levels
        if (dimensionKey === "targetRoles") {
          if (intent.targetLevel.some(lvl => conceptLower.includes(lvl.toLowerCase()) || lvl.toLowerCase().includes(conceptLower))) {
            score += 40;
          }
        }

        // Match against intended functions
        if (intent.functions.some(f => f.toLowerCase() === conceptLower || conceptLower.includes(f.toLowerCase()))) {
          score += 35;
        }

        // Match against operating models
        if (intent.operatingModels.some(om => om.toLowerCase() === conceptLower || conceptLower.includes(om.toLowerCase()))) {
          score += 30;
        }

        // Match against transformation/platform ownership
        if (intent.ownership.some(own => own.toLowerCase() === conceptLower || conceptLower.includes(own.toLowerCase()))) {
          score += 25;
        }

        // Match against industry preference context
        if (intent.industries.some(ind => ind.toLowerCase() === conceptLower || conceptLower.includes(ind.toLowerCase()))) {
          score += 15;
        }

        // Set computed weight
        scores[conceptName] = score;
      }
    }

    // 2. Formulate Hypothesis groups and compile portal-specific queries
    const searchHypotheses: SearchPlan["searchHypotheses"] = [];
    const rankedQueries: SearchPlan["rankedQueries"] = [];
    const seenQueries = new Set<string>();

    const dimensionMetadata: Record<string, { name: string; desc: string }> = {
      targetRoles: {
        name: "Marketing & Growth Leadership Core",
        desc: "High-priority executive titles matching the candidate's target career levels."
      },
      leadershipModel: {
        name: "Global Capability & CoE Operating Models",
        desc: "CoE and GCC operating models matching the candidate's executive scaling intent."
      },
      functionalExpertise: {
        name: "High-Yield Functional Domains",
        desc: "Targeted performance marketing, CRM, and functional domains aligning with growth intent."
      },
      platformOwnership: {
        name: "Platform & Digital Product Ownership",
        desc: "MarTech, AdTech, and transformation platform ownership targets."
      },
      strategicMandate: {
        name: "Enterprise Transformation Mandates",
        desc: "Transformation, commercial excellence, and customer growth mandates."
      }
    };

    for (const [dimensionKey, concepts] of Object.entries(lexicon.dimensions)) {
      const meta = dimensionMetadata[dimensionKey] || { name: dimensionKey, desc: "" };
      const conceptMap = concepts as Record<string, string[]>;
      const dimensionQueries: string[] = [];

      // Sort concepts within this dimension by computed score
      const sortedConcepts = Object.keys(conceptMap).sort(
        (a, b) => (scores[b] || 0) - (scores[a] || 0)
      );

      for (const conceptName of sortedConcepts) {
        const conceptScore = scores[conceptName] || 0;
        if (conceptScore <= 0 && dimensionKey !== "targetRoles") continue; // skip irrelevant concepts

        const portalPhrases = conceptMap[conceptName] || [];
        for (const phrase of portalPhrases) {
          if (!seenQueries.has(phrase)) {
            seenQueries.add(phrase);
            rankedQueries.push({
              query: phrase,
              score: conceptScore + (dimensionKey === "targetRoles" ? 30 : 0), // boost core titles
              dimension: dimensionKey,
              concept: conceptName
            });
            dimensionQueries.push(phrase);
          }
        }
      }

      searchHypotheses.push({
        name: meta.name,
        description: meta.desc,
        queries: dimensionQueries
      });
    }

    // Sort all portal queries by score descending
    rankedQueries.sort((a, b) => b.score - a.score);

    return {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      candidateIntent: intent,
      searchHypotheses,
      rankedQueries
    };
  }
}
