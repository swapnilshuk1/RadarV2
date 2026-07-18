import fs from "fs";
import path from "path";

export interface CareerIntent {
  targetLevel: string[];
  functions: string[];
  operatingModels: string[];
  ownership: string[];
  industries: string[];
  exclusions: string[];
}

export class CareerIntentModel {
  /**
   * Translates the raw Candidate Profile into a unified Career Intent representation,
   * separating past experience from future search direction.
   */
  public static extractIntent(profilePath: string, taxonomyPath: string): CareerIntent {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf-8"));

    // 1. Target Level Mapping
    const targetTitles: string[] = profile.strategy?.targetTitles || [];
    const targetLevels = new Set<string>();
    targetTitles.forEach(title => {
      const lower = title.toLowerCase();
      if (lower.includes("cmo") || lower.includes("chief")) targetLevels.add("CMO");
      if (lower.includes("vp") || lower.includes("vice president")) targetLevels.add("VP");
      if (lower.includes("director")) targetLevels.add("Director");
      if (lower.includes("svp") || lower.includes("senior vice president")) targetLevels.add("SVP");
      if (lower.includes("head")) targetLevels.add("Head");
    });
    if (targetLevels.size === 0) {
      targetLevels.add("VP").add("Head"); // sensible executive defaults
    }

    // 2. Functional Intent
    const functionsSet = new Set<string>();
    const capabilities = profile.capabilities || {};
    Object.keys(capabilities).forEach(capCategory => {
      if (capCategory === "growth") {
        functionsSet.add("Marketing Leadership");
        functionsSet.add("Growth");
      }
      if (capCategory === "crm") {
        functionsSet.add("CRM");
        functionsSet.add("Lifecycle Marketing");
      }
      if (capCategory === "analytics") {
        functionsSet.add("Digital Marketing");
      }
    });
    // Add raw functions from profile
    const profileFunctions: string[] = profile.functions || [];
    profileFunctions.forEach(f => functionsSet.add(f));

    // 3. Operating Models
    const operatingModels = new Set<string>();
    const skills: string[] = profile.skills || [];
    skills.forEach(s => {
      const lower = s.toLowerCase();
      if (lower.includes("coe") || lower.includes("excellence")) operatingModels.add("CoE");
      if (lower.includes("gcc") || lower.includes("global capability")) operatingModels.add("GCC");
      if (lower.includes("shared services")) operatingModels.add("Shared Services");
    });
    if (operatingModels.size === 0) {
      operatingModels.add("CoE"); // Default CoE focus
    }

    // 4. Platform / Transformation Ownership
    const ownership = new Set<string>();
    skills.forEach(s => {
      const lower = s.toLowerCase();
      if (lower.includes("transformation")) ownership.add("Transformation");
      if (lower.includes("platform")) ownership.add("Platform Ownership");
      if (lower.includes("product owner") || lower.includes("product ownership")) ownership.add("Product Ownership");
    });

    // 5. Industries of Preference
    const industries: string[] = profile.preferences?.industries || [];

    // 6. Exclusions (from Out-of-Scope Concentric Rings of taxonomy)
    const exclusions: string[] = taxonomy.concentricRings?.excluded || ["Engineering", "Finance", "HR"];

    return {
      targetLevel: Array.from(targetLevels),
      functions: Array.from(functionsSet),
      operatingModels: Array.from(operatingModels),
      ownership: Array.from(ownership),
      industries: industries.slice(0, 5), // top 5 priority industries
      exclusions
    };
  }
}
