/**
 * scripts/eval/v4-simulation/generic-language-miner.ts
 *
 * Generic Language & Cliché Mining Engine for RADAR V4 Phase 8.
 * Extracts recurring 3-to-6-word phrases across the editorial briefs of the corpus,
 * computes frequency and cross-category distribution, and flags non-evidence-grounded boilerplate.
 */

import type { SimulationRecord, GenericPhraseMatch } from "./types";

function extractNGrams(text: string, minN: number = 3, maxN: number = 6): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const nGrams: string[] = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      nGrams.push(words.slice(i, i + n).join(" "));
    }
  }
  return nGrams;
}

const STOP_PATTERNS = [
  "executive brief",
  "radar v4",
  "one minute tldr",
  "strategic upside",
  "qualitative reasoning",
  "structured sections",
  "provenance",
  "high evidence quality",
  "medium evidence quality",
  "observed in jd",
  "inferred from role",
];

export function mineGenericLanguage(records: SimulationRecord[]): GenericPhraseMatch[] {
  const phraseToRecords = new Map<string, Set<number>>();
  const phraseToCategories = new Map<string, Set<string>>();

  records.forEach((rec, idx) => {
    const brief = rec.briefModel;
    if (!brief) return;

    // Collect editorial prose text
    const texts: string[] = [
      brief.memory.headline,
      brief.memory.retentionSentence,
      brief.memory.primaryOpportunity,
      brief.memory.primaryRisk,
      brief.memory.recommendedAction,
      brief.memory.tradeoff,
      brief.memory.first90Days,
      brief.memory.whyNow,
      ...(brief.oneMinuteTLDR?.whyPursue || []),
      ...(brief.oneMinuteTLDR?.watchFor || []),
      brief.oneMinuteTLDR?.bottomLine || "",
      brief.strategicUpside?.headline || "",
      ...(brief.strategicUpside?.points || []),
    ];

    const combinedText = texts.filter(Boolean).join(" ");
    const nGrams = extractNGrams(combinedText, 3, 5);

    // Filter out role/company specific terms for this record
    const roleWords = rec.role.toLowerCase().split(/\s+/);
    const companyWords = rec.company.toLowerCase().split(/\s+/);

    for (const ng of nGrams) {
      if (STOP_PATTERNS.some((p) => ng.includes(p))) continue;
      // Skip if contains company name or specific role token
      if (companyWords.some((w) => w.length > 3 && ng.includes(w))) continue;

      if (!phraseToRecords.has(ng)) {
        phraseToRecords.set(ng, new Set());
        phraseToCategories.set(ng, new Set());
      }
      phraseToRecords.get(ng)!.add(idx);
      phraseToCategories.get(ng)!.add(rec.category);
    }
  });

  const totalRecords = records.length || 1;
  const matches: GenericPhraseMatch[] = [];

  for (const [phrase, recordSet] of phraseToRecords.entries()) {
    const count = recordSet.size;
    const catSet = phraseToCategories.get(phrase)!;
    // Phrases appearing in 4+ distinct records across 2+ categories
    if (count >= 4 && catSet.size >= 2) {
      const percentage = Math.round((count / totalRecords) * 1000) / 10;
      
      // Check if evidence supported or pure cliché template
      const isCliché =
        phrase.includes("driving business growth") ||
        phrase.includes("culture of excellence") ||
        phrase.includes("strategic initiatives") ||
        phrase.includes("cross functional teams") ||
        phrase.includes("best and the brightest") ||
        phrase.includes("standard executive application") ||
        phrase.includes("within first 60 days") ||
        phrase.includes("operational baseline across");

      matches.push({
        phrase,
        frequency: count,
        percentageOfCorpus: percentage,
        categories: Array.from(catSet),
        isEvidenceSupported: !isCliché,
      });
    }
  }

  // Sort by frequency descending
  matches.sort((a, b) => b.frequency - a.frequency);
  return matches.slice(0, 30);
}
