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

    // Helper: Extract functional tokens excluding generic seniority tokens
    const SENIORITY_TOKENS = new Set([
      "chief", "c-level", "cxo", "vp", "vice", "president", "svp", "evp",
      "director", "head", "lead", "officer", "manager", "global", "executive", "senior"
    ]);

    const STOP_WORDS = new Set([
      "of", "and", "the", "in", "for", "to", "a", "an", "&"
    ]);

    const extractFunctionalTokens = (text: string): Set<string> => {
      const tokens = new Set<string>();
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
      for (const w of words) {
        if (w.length > 2 && !SENIORITY_TOKENS.has(w) && !STOP_WORDS.has(w)) {
          tokens.add(w);
        }
      }
      return tokens;
    };

    const extractSeniorityTokens = (text: string): Set<string> => {
      const tokens = new Set<string>();
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
      for (const w of words) {
        if (SENIORITY_TOKENS.has(w)) {
          tokens.add(w);
        }
      }
      return tokens;
    };

    const candidateFunctionalTokens = new Set<string>();
    functions.forEach((f) => extractFunctionalTokens(f).forEach((t) => candidateFunctionalTokens.add(t)));
    targetTitles.forEach((t) => extractFunctionalTokens(t).forEach((t) => candidateFunctionalTokens.add(t)));

    const candidateSeniorityTokens = new Set<string>();
    targetLevels.forEach((l) => extractSeniorityTokens(l).forEach((t) => candidateSeniorityTokens.add(t)));
    targetTitles.forEach((t) => extractSeniorityTokens(t).forEach((t) => candidateSeniorityTokens.add(t)));

    const candidateDomainTerms = new Set<string>();
    operatingModels.forEach((m) => candidateDomainTerms.add(m.toLowerCase().trim()));
    ownership.forEach((o) => candidateDomainTerms.add(o.toLowerCase().trim()));
    functions.forEach((f) => candidateDomainTerms.add(f.toLowerCase().trim()));
    targetTitles.forEach((t) => candidateDomainTerms.add(t.toLowerCase().trim()));

    const matchesDimensionConcept = (dimensionKey: string, conceptName: string, phrases: string[]): boolean => {
      const allConceptPhrases = [conceptName, ...phrases].map((p) => p.toLowerCase());

      // 1. Direct match: Exact or substring match against any declared candidate title or domain term
      for (const t of targetTitles) {
        const lowerT = t.toLowerCase();
        for (const p of allConceptPhrases) {
          if (lowerT === p || lowerT.includes(p) || p.includes(lowerT)) return true;
        }
      }

      for (const domainTerm of candidateDomainTerms) {
        if (!domainTerm) continue;
        for (const p of allConceptPhrases) {
          if (domainTerm === p || (domainTerm.length > 3 && (p.includes(domainTerm) || domainTerm.includes(p)))) {
            return true;
          }
        }
      }

      // 2. Target Roles dimension: Must match FUNCTION + SENIORITY conjunction
      if (dimensionKey === "targetRoles") {
        const conceptFuncTokens = extractFunctionalTokens(conceptName);
        phrases.forEach((p) => extractFunctionalTokens(p).forEach((t) => conceptFuncTokens.add(t)));

        let functionMatches = false;
        if (candidateFunctionalTokens.size === 0) {
          functionMatches = false;
        } else {
          for (const tok of conceptFuncTokens) {
            if (candidateFunctionalTokens.has(tok)) {
              functionMatches = true;
              break;
            }
          }
        }

        if (!functionMatches) return false;

        if (candidateSeniorityTokens.size > 0) {
          const conceptSeniorityTokens = extractSeniorityTokens(conceptName);
          phrases.forEach((p) => extractSeniorityTokens(p).forEach((t) => conceptSeniorityTokens.add(t)));

          let seniorityMatches = false;
          for (const s of conceptSeniorityTokens) {
            if (candidateSeniorityTokens.has(s)) {
              seniorityMatches = true;
              break;
            }
          }
          return seniorityMatches;
        }

        return true;
      }

      // 3. Functional expertise: Must match candidate functional tokens
      if (dimensionKey === "functionalExpertise") {
        const conceptFuncTokens = extractFunctionalTokens(conceptName);
        phrases.forEach((p) => extractFunctionalTokens(p).forEach((t) => conceptFuncTokens.add(t)));

        for (const tok of conceptFuncTokens) {
          if (candidateFunctionalTokens.has(tok)) return true;
        }
        return false;
      }

      // 4. Other dimensions (leadershipModel, platformOwnership, strategicMandate):
      // Token overlap only against functional tokens / domain terms, NEVER generic seniority tokens
      const conceptFuncTokens = extractFunctionalTokens(conceptName);
      for (const tok of conceptFuncTokens) {
        if (candidateFunctionalTokens.has(tok)) return true;
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
            if (matchesDimensionConcept(dimensionKey, conceptName, phrases)) {
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

