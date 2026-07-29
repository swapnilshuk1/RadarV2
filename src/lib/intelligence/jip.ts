/**
 * jip.ts (Job Intelligence Pipeline)
 *
 * Implements Phase 4 (Job Intelligence Pipeline).
 * Normalizes job inputs and uses Capability Registry lexical matching to extract requirements.
 */

import { CapabilityRegistry } from "../capability/Registry";
import type { OpportunityIdentity } from "../domain/opportunity";

export class JobIntelligencePipeline {
  /**
   * Normalizes a raw opportunity entry and performs high-speed lexical Capability Extraction.
   */
  public static project(raw: {
    jobHash: string;
    role: string;
    company: string;
    location?: string;
    postedRelative?: string;
    applyUrl?: string;
    description: string;
    salaryBounds?: { min?: number; max?: number; currency?: string };
  }): OpportunityIdentity {
    const jobHash = raw.jobHash;
    const title = raw.role;
    const companyName = raw.company;
    const description = raw.description || "";

    // 1. Lexical Capability Extraction
    // Split description into distinct alphanumeric words for speed lexical synonym mapping
    const words = description
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .split(/\s+/);

    const matchedCapabilities = new Set<string>();

    // Scan all registry capabilities to find lexical synonym occurrences
    for (const capability of CapabilityRegistry.getAll()) {
      for (const alias of capability.aliases) {
        // If the alias matches as a sequence in description, match it!
        if (description.toLowerCase().includes(alias.toLowerCase())) {
          matchedCapabilities.add(capability.id);
          break; // Match found for this capability, stop scanning aliases
        }
      }
    }

    // Default fallbacks if no capability matched (to keep the list robust)
    if (matchedCapabilities.size === 0) {
      // Check title keywords for smart fallbacks
      const titleLower = title.toLowerCase();
      if (titleLower.includes("crm") || titleLower.includes("salesforce") || titleLower.includes("marketing")) {
        matchedCapabilities.add("cap_crm_strategy");
      }
      if (titleLower.includes("director") || titleLower.includes("vp") || titleLower.includes("head") || titleLower.includes("chief")) {
        matchedCapabilities.add("cap_executive_growth_scale");
      }
      if (matchedCapabilities.size === 0) {
        matchedCapabilities.add("cap_enterprise_financial_stewardship"); // Base corporate default
      }
    }

    // 2. Normalize salary bounds
    const salaryBounds = raw.salaryBounds || {
      min: undefined,
      max: undefined,
      currency: "INR"
    };

    return {
      id: jobHash,
      companyId: `comp_${companyName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      companyName,
      canonicalTitle: title,
      location: raw.location || "Remote",
      employmentType: "Full-time",
      postingWindow: raw.postedRelative || "Recently",
      fingerprint: `fp_${jobHash}`,
      lifecycle: "SHORTLIST",
      description,
      salaryBounds,
      requiredCapabilities: Array.from(matchedCapabilities),
      updatedAt: new Date().toISOString()
    };
  }
}
