// scripts/scraper/run/career-intent.ts

import fs from "fs";
import path from "path";
import { getRepositories } from "../../../src/data/sqlite/provider";

export interface CareerIntent {
  targetLevel: string[];
  functions: string[];
  operatingModels: string[];
  ownership: string[];
  industries: string[];
  exclusions: string[];
  targetTitles: string[];
  preferredLocations: string[];
}

export class CareerIntentModel {
  /**
   * Derives dynamic Career Intent directly from an in-memory or database-stored
   * CandidateState object, eliminating static filesystem dependencies.
   */
  public static extractIntentFromCandidateState(candidateState: any, _taxonomyPath?: string): CareerIntent {
    const intentData = candidateState?.intent || {};
    const targetRoles = intentData.targetRoles || [];
    const targetTitles = targetRoles.map((r: any) => typeof r === "string" ? r : r?.title).filter(Boolean);
    const preferredLocations = intentData.locations || ["Gurugram", "Remote India"];
    const industries = intentData.industries || [];
    const profileFunctions = intentData.functions || [];

    const targetLevels = new Set<string>();
    targetTitles.forEach((title: string) => {
      const lower = title.toLowerCase();
      if (lower.includes("cmo") || lower.includes("chief") || lower.includes("cco")) targetLevels.add("Chief");
      if (lower.includes("vp") || lower.includes("vice president")) targetLevels.add("VP");
      if (lower.includes("director")) targetLevels.add("Director");
      if (lower.includes("svp") || lower.includes("senior vice president")) targetLevels.add("SVP");
      if (lower.includes("head") || lower.includes("lead")) targetLevels.add("Head");
    });

    if (targetLevels.size === 0) {
      targetLevels.add("VP").add("Head").add("Chief");
    }

    return {
      targetLevel: Array.from(targetLevels),
      functions: profileFunctions.length > 0 ? profileFunctions : ["Marketing", "Growth"],
      operatingModels: ["B2B", "Enterprise", "Scale-up"],
      ownership: ["P&L", "Commercial"],
      industries,
      exclusions: [],
      targetTitles: targetTitles.length > 0 ? targetTitles : ["Vice President", "Chief Commercial Officer", "Head of Growth"],
      preferredLocations,
    };
  }

  /**
   * Translates raw Candidate Profile fixture into dynamic Career Intent.
   * Reserved strictly for local/offline unit test fixtures.
   */
  public static extractIntent(profilePath: string, taxonomyPath: string): CareerIntent {
    let targetTitles: string[] = [];
    let preferredLocations: string[] = [];
    let industries: string[] = [];
    let profileFunctions: string[] = [];

    // Attempt 1: Fetch dynamic intent from SQLite database
    try {
      const repos = getRepositories();
      // Synchronous attempt or static parse
      if (fs.existsSync(profilePath)) {
        const raw = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
        targetTitles = raw.strategy?.targetTitles || [];
        preferredLocations = raw.preferences?.preferredLocations || ["Gurugram", "Remote India"];
        industries = raw.preferences?.industries || [];
        profileFunctions = raw.functions || [];
      }
    } catch (err) {
      console.warn("[CareerIntentModel] DB query fallback to static profile file:", err);
    }

    // 1. Target Level & Titles Mapping
    const targetLevels = new Set<string>();
    targetTitles.forEach(title => {
      const lower = title.toLowerCase();
      if (lower.includes("cmo") || lower.includes("chief") || lower.includes("cco")) targetLevels.add("Chief");
      if (lower.includes("vp") || lower.includes("vice president")) targetLevels.add("VP");
      if (lower.includes("director")) targetLevels.add("Director");
      if (lower.includes("svp") || lower.includes("senior vice president")) targetLevels.add("SVP");
      if (lower.includes("head") || lower.includes("lead")) targetLevels.add("Head");
    });

    if (targetLevels.size === 0) {
      targetLevels.add("VP").add("Head").add("Chief");
    }

    if (targetTitles.length === 0) {
      targetTitles = ["Vice President", "Chief Commercial Officer", "Head of Growth"];
    }

    // 2. Functional Intent
    const functionsSet = new Set<string>();
    profileFunctions.forEach(f => functionsSet.add(f));
    functionsSet.add("Marketing Leadership");
    functionsSet.add("Growth Strategy");
    functionsSet.add("Commercial Operations");

    // 3. Operating Models
    const operatingModels = new Set<string>(["CoE", "GCC"]);

    // 4. Platform / Transformation Ownership
    const ownership = new Set<string>(["Transformation", "Platform Ownership"]);

    // 5. Exclusions
    let exclusions: string[] = ["Engineering", "HR"];
    if (fs.existsSync(taxonomyPath)) {
      try {
        const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf-8"));
        exclusions = taxonomy.concentricRings?.excluded || exclusions;
      } catch {}
    }

    return {
      targetLevel: Array.from(targetLevels),
      functions: Array.from(functionsSet),
      operatingModels: Array.from(operatingModels),
      ownership: Array.from(ownership),
      industries: industries.slice(0, 5),
      exclusions,
      targetTitles,
      preferredLocations,
    };
  }
}
