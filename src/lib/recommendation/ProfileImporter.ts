/**
 * ProfileImporter
 * 
 * Bootstrap mechanism: reads .radar/profile.yaml ONCE and persists into the
 * CandidateProfileStore (SQLite). The recommendation engine NEVER reads YAML.
 * 
 * Usage: run once at setup time or when the profile changes.
 */

import yaml from "js-yaml";
import type { CandidateProfile } from "../../domain/entities";

function getNodeFs() {
  if (typeof window !== "undefined") return null;
  try {
    return typeof require !== "undefined" ? require("fs") : null;
  } catch {
    return null;
  }
}

function getNodePath() {
  if (typeof window !== "undefined") return null;
  try {
    return typeof require !== "undefined" ? require("path") : null;
  } catch {
    return null;
  }
}

function generateUUID(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface RawProfile {
  // Identity
  name?: string;
  email?: string;

  // Career capital
  experience?: any[];
  industries?: string[];
  leadership?: string[];
  international?: string[];
  transformation?: string[];
  technology?: string[];
  pnl?: string[];
  functions?: string[];
  skills?: string[];

  // Preferences and constraints
  preferences?: Record<string, any>;
  hardConstraints?: string[];
  softConstraints?: string[];
}

export class ProfileImporter {
  /**
   * Reads a YAML file and converts it to a versioned CandidateProfile entity.
   * The caller is responsible for persisting the returned entity.
   */
  static fromYaml(yamlPath: string, personId: string): CandidateProfile {
    const path = getNodePath();
    const fs = getNodeFs();
    if (!path || !fs) {
      throw new Error("Cannot run fromYaml in non-Node environment");
    }

    const resolvedPath = path.resolve(yamlPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Profile YAML not found at: ${resolvedPath}`);
    }

    const raw = yaml.load(fs.readFileSync(resolvedPath, "utf-8")) as RawProfile;

    const now = new Date().toISOString();
    // Version is derived from a content hash to support immutable versioning
    const version = `v${Date.now()}`;

    const profile: CandidateProfile = {
      id: generateUUID(),
      personId,
      version,
      experience: raw.experience ?? [],
      industries: raw.industries ?? [],
      leadership: raw.leadership ?? [],
      international: raw.international ?? [],
      transformation: raw.transformation ?? [],
      technology: raw.technology ?? [],
      pnl: raw.pnl ?? [],
      functions: raw.functions ?? [],
      skills: raw.skills ?? [],
      preferences: raw.preferences ?? {},
      hardConstraints: raw.hardConstraints ?? [],
      softConstraints: raw.softConstraints ?? [],
      createdAt: now,
      updatedAt: now,
      provenance: {
        schemaVersion: "1.0",
        pipeline: "ProfileImporter",
        timestamp: now,
      } as any,
    };

    return profile;
  }

  /**
   * Validates that the YAML file exists and has minimum required fields.
   */
  static validate(yamlPath: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const path = getNodePath();
    const fs = getNodeFs();
    if (!path || !fs) {
      return { valid: false, errors: ["Cannot run validate in non-Node environment"] };
    }

    const resolvedPath = path.resolve(yamlPath);

    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, errors: [`File not found: ${resolvedPath}`] };
    }

    const raw = yaml.load(fs.readFileSync(resolvedPath, "utf-8")) as RawProfile;

    if (!raw.experience || raw.experience.length === 0) {
      errors.push("experience is empty — the scorer needs at least one career entry");
    }
    if (!raw.skills || raw.skills.length === 0) {
      errors.push("skills is empty");
    }
    if (!raw.hardConstraints || raw.hardConstraints.length === 0) {
      errors.push("hardConstraints is empty — define at least one deal-breaker");
    }

    return { valid: errors.length === 0, errors };
  }
}
