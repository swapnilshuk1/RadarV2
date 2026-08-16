// scripts/scraper/run/search-planner.ts

import fs from "fs";
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
   * Dynamic Search Planner: Synthesizes portal queries based on Career Intent,
   * user target titles, preferred locations, and lexicon fallbacks.
   * Backward Compatible: If lexicon or taxonomy files are missing, generates
   * dynamic queries directly from user target titles and locations.
   */
  public static plan(
    intent: CareerIntent,
    taxonomyPath: string,
    lexiconPath: string
  ): SearchPlan {
    const rankedQueries: SearchPlan["rankedQueries"] = [];
    const searchHypotheses: SearchPlan["searchHypotheses"] = [];
    const seenQueries = new Set<string>();

    // 1. Dynamic Primary Queries from User Target Titles & Preferred Locations
    const primaryQueries: string[] = [];
    for (const title of intent.targetTitles) {
      if (!seenQueries.has(title)) {
        seenQueries.add(title);
        primaryQueries.push(title);
        rankedQueries.push({
          query: title,
          score: 95,
          dimension: "targetRoles",
          concept: title,
        });
      }

    }

    searchHypotheses.push({
      name: "Dynamic Executive Target Titles & Locations",
      description: "High-priority portal search queries dynamically compiled from user profile career intent.",
      queries: primaryQueries,
    });

    // 2. Lexicon Fallback Enrichment
    if (fs.existsSync(lexiconPath)) {
      try {
        const lexicon = JSON.parse(fs.readFileSync(lexiconPath, "utf-8"));
        for (const [dimensionKey, concepts] of Object.entries(lexicon.dimensions || {})) {
          const conceptMap = concepts as Record<string, string[]>;
          const dimensionQueries: string[] = [];

          for (const [conceptName, portalPhrases] of Object.entries(conceptMap)) {
            for (const phrase of portalPhrases || []) {
              if (!seenQueries.has(phrase)) {
                seenQueries.add(phrase);
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

          if (dimensionQueries.length > 0) {
            searchHypotheses.push({
              name: `Lexicon ${dimensionKey}`,
              description: `Lexicon queries for ${dimensionKey}`,
              queries: dimensionQueries,
            });
          }
        }
      } catch (err) {
        console.warn("[SearchPlanner] Lexicon parse fallback triggered:", err);
      }
    }

    // Sort all queries by score descending
    rankedQueries.sort((a, b) => b.score - a.score);

    return {
      version: "2.0.0",
      generatedAt: new Date().toISOString(),
      candidateIntent: intent,
      searchHypotheses,
      rankedQueries,
    };
  }
}
