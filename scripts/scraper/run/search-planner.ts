// scripts/scraper/run/search-planner.ts

import fs from "fs";
import type { CareerIntent } from "./career-intent";

export class InsufficientSearchCriteriaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientSearchCriteriaError";
  }
}

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
   * Dynamic Search Planner: Synthesizes portal queries strictly from Career Intent
   * and matching ontology mappings.
   * Invariant: Every emitted query must trace directly to declared candidate criteria
   * or an explicit ontology mapping matching those criteria. Global dumping is eliminated.
   */
  public static plan(
    intent: CareerIntent,
    taxonomyPath: string,
    lexiconPath: string
  ): SearchPlan {
    const rankedQueries: SearchPlan["rankedQueries"] = [];
    const searchHypotheses: SearchPlan["searchHypotheses"] = [];
    const seenQueries = new Set<string>();

    const targetTitles = intent.targetTitles || [];
    const functions = intent.functions || [];
    const operatingModels = intent.operatingModels || [];
    const ownership = intent.ownership || [];
    const targetLevels = intent.targetLevel || [];

    // 1. Dynamic Primary Queries from User Target Titles
    const primaryQueries: string[] = [];
    for (const title of targetTitles) {
      const trimmed = title.trim();
      if (trimmed && !seenQueries.has(trimmed.toLowerCase())) {
        seenQueries.add(trimmed.toLowerCase());
        primaryQueries.push(trimmed);
        rankedQueries.push({
          query: trimmed,
          score: 95,
          dimension: "targetRoles",
          concept: trimmed,
        });
      }
    }

    if (primaryQueries.length > 0) {
      searchHypotheses.push({
        name: "Dynamic Executive Target Titles",
        description: "High-priority portal search queries dynamically compiled from user profile career intent.",
        queries: primaryQueries,
      });
    }

    // Normalized matching sets for ontology lookups
    const matchTokens = new Set<string>();
    targetTitles.forEach((t) => t.toLowerCase().split(/\s+/).forEach((tok) => tok.length > 2 && matchTokens.add(tok)));
    functions.forEach((f) => f.toLowerCase().split(/\s+/).forEach((tok) => tok.length > 2 && matchTokens.add(tok)));
    operatingModels.forEach((m) => m.toLowerCase().split(/\s+/).forEach((tok) => tok.length > 2 && matchTokens.add(tok)));
    ownership.forEach((o) => o.toLowerCase().split(/\s+/).forEach((tok) => tok.length > 2 && matchTokens.add(tok)));
    targetLevels.forEach((l) => l.toLowerCase().split(/\s+/).forEach((tok) => tok.length > 2 && matchTokens.add(tok)));

    const matchesIntent = (conceptName: string, phrases: string[]): boolean => {
      const lowerConcept = conceptName.toLowerCase();
      // Direct substring match with declared criteria
      for (const t of targetTitles) {
        if (lowerConcept.includes(t.toLowerCase()) || t.toLowerCase().includes(lowerConcept)) return true;
      }
      for (const f of functions) {
        if (lowerConcept.includes(f.toLowerCase()) || f.toLowerCase().includes(lowerConcept)) return true;
      }
      for (const m of operatingModels) {
        if (lowerConcept.includes(m.toLowerCase()) || m.toLowerCase().includes(lowerConcept)) return true;
      }
      for (const o of ownership) {
        if (lowerConcept.includes(o.toLowerCase()) || o.toLowerCase().includes(lowerConcept)) return true;
      }
      // Token overlap match
      for (const token of matchTokens) {
        if (lowerConcept.includes(token)) return true;
        for (const phrase of phrases) {
          if (phrase.toLowerCase().includes(token)) return true;
        }
      }
      return false;
    };

    // 2. Criteria-Scoped Lexicon Enrichment
    if (fs.existsSync(lexiconPath)) {
      try {
        const lexicon = JSON.parse(fs.readFileSync(lexiconPath, "utf-8"));
        for (const [dimensionKey, concepts] of Object.entries(lexicon.dimensions || {})) {
          const conceptMap = concepts as Record<string, string[]>;
          const dimensionQueries: string[] = [];

          for (const [conceptName, portalPhrases] of Object.entries(conceptMap)) {
            const phrases = portalPhrases || [];
            // Strictly check if concept matches candidate intent
            if (matchesIntent(conceptName, phrases)) {
              for (const phrase of phrases) {
                const lowerPhrase = phrase.toLowerCase();
                if (!seenQueries.has(lowerPhrase)) {
                  seenQueries.add(lowerPhrase);
                  rankedQueries.push({
                    query: phrase,
                    score: 70,
                    dimension: dimensionKey,
                    concept: conceptName,
                  });
                  dimensionQueries.push(phrase);
                }
              }
            }
          }

          if (dimensionQueries.length > 0) {
            searchHypotheses.push({
              name: `Lexicon ${dimensionKey}`,
              description: `Lexicon queries matching candidate criteria for ${dimensionKey}`,
              queries: dimensionQueries,
            });
          }
        }
      } catch (err) {
        console.warn("[SearchPlanner] Lexicon parse warning:", err);
      }
    }

    // Sort all queries by score descending
    rankedQueries.sort((a, b) => b.score - a.score);

    // Fail-fast if no queries could be generated from criteria
    if (rankedQueries.length === 0) {
      throw new InsufficientSearchCriteriaError(
        "[SearchPlanner] No valid search queries could be compiled from candidate intent. Please specify target roles, titles, or functional domains."
      );
    }

    return {
      version: "2.0.0",
      generatedAt: new Date().toISOString(),
      candidateIntent: intent,
      searchHypotheses,
      rankedQueries,
    };
  }
}

