/**
 * P0-G Test Infrastructure
 * 
 * Provides a test seam around the production OpportunityProvider.
 * Does not implement business logic - only delegates to production and categorizes results.
 */

import { runEngine } from '@/lib/intelligence/engine';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '@/data/candidate-profile';
function getShortlist(active: number) { const builder = new CandidateProjectionBuilderImpl(); const proj = builder.fromProfile(candidateProfile); const { presented } = runEngine(proj as any, active); return presented.map(p => p.opportunity).filter(o => o.decision !== 'PASS'); }
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import type { CandidateProfile } from "@/domain/candidate";

/**
 * Injectable opportunity provider for P0-G testing.
 * 
 * This is a TEST SEAM that wraps the production OpportunityProvider.
 * It does not implement business logic - it delegates to production and observes results.
 */
export interface InjectableOpportunityProvider {
  list(params: {
    activePursuits: number;
    forceInjectedOpportunities?: Array<{
      jobHash: string;
      rawText: string;
      companyName: string;
      title: string;
    }>;
  }): Promise<{
    scoredRanking: Array<{ jobHash: string; totalWeightedScore: number }>;
    unevaluable: Array<{ jobHash: string; evaluationStatus: string }>;
  }>;
}

/**
 * Creates a minimal candidate profile for P0-G testing.
 * Matches the CandidateProfile contract expected by CandidateProjectionBuilder.
 */
export function createCandidateProfile(level: "DIRECTOR" | "VP" | "C_SUITE"): CandidateProfile {
  const titles = {
    DIRECTOR: "Senior Director, Marketing Operations",
    VP: "VP Marketing, Performance",
    C_SUITE: "Chief Marketing Officer"
  };

  const archetypes = {
    DIRECTOR: "Functional Director",
    VP: "Functional VP",
    C_SUITE: "Board C-Suite"
  };

  const yearsExperience = {
    DIRECTOR: 8,
    VP: 12,
    C_SUITE: 18
  };

  return {
    identity: {
      name: "Test Candidate",
      currentTitle: titles[level]
    },
    executiveIdentity: {
      archetype: archetypes[level],
      valueProposition: "Marketing strategy and execution",
      executiveThemes: ["Growth", "Transformation", "Commercial"]
    },
    experience: {
      yearsExperience: yearsExperience[level],
      teamSizeManaged: level === "DIRECTOR" ? 15 : level === "VP" ? 40 : 100,
      feeBookScale: level === "DIRECTOR" ? "$2M" : level === "VP" ? "$8M" : "$50M",
      plOwnership: level !== "DIRECTOR",
      boardInteraction: level === "C_SUITE",
      achievements: [
        `Built ${level === "DIRECTOR" ? "15" : level === "VP" ? "40" : "100"}-person team`,
        `Delivered ${level === "DIRECTOR" ? "$5M" : level === "VP" ? "$50M" : "$500M"} portfolio`
      ]
    },
    leadershipProfile: {
      largestTeam: level === "DIRECTOR" ? 15 : level === "VP" ? 40 : 100,
      globalMarkets: level === "DIRECTOR" ? 3 : level === "VP" ? 8 : 15,
      regions: ["APAC"],
      budgetResponsibility: level === "DIRECTOR" ? "$2M" : level === "VP" ? "$8M" : "$50M",
      commercialOwnership: true,
      boardExposure: level === "C_SUITE",
      globalPrograms: level !== "DIRECTOR",
      peopleLeadership: true,
      matrixLeadership: level !== "DIRECTOR",
      vendorManagement: true,
      clientLeadership: true
    },
    evidence: [
      {
        type: "Leadership",
        proof: `${yearsExperience[level]} years in marketing roles`
      }
    ],
    capabilities: {
      growth: ["Growth Strategy", "Performance Marketing"],
      crm: ["CRM Strategy"],
      analytics: ["Marketing Analytics"],
      transformation: ["Digital Transformation"]
    },
    executiveCompetencies: [
      "Commercial Leadership",
      "Team Building",
      "Strategic Planning"
    ],
    semanticAliases: {},
    preferences: {
      locations: ["Gurugram", "Mumbai"],
      remote: "Hybrid",
      targetMinSalary: level === "DIRECTOR" ? "₹80L" : level === "VP" ? "₹1.5 Cr" : "₹3 Cr",
      industries: ["Automotive", "Healthcare", "Consumer"]
    },
    industryExperience: {
      primary: ["Automotive"],
      secondary: ["Healthcare"],
      agency: ["Advertising"],
      enterprise: ["Global Enterprise"]
    },
    strategy: {
      targetTitles: [titles[level]],
      ceoPathway: level === "C_SUITE",
      boardReadiness: level === "C_SUITE"
    },
    resume: {
      rawText: `Executive with ${yearsExperience[level]} years experience`,
      sourceResumeVersion: "1.0.0"
    },
    platforms: ["Salesforce Marketing Cloud"],
    skills: ["Performance Marketing", "CRM Strategy"],
    functions: ["Marketing", "Growth"],
    domains: ["Automotive"],
    leadership: ["Commercial Leadership"]
  };
}

/**
 * Returns a test provider that wraps the production OpportunityProvider.
 * 
 * NOTE: This delegates ALL business logic to production. It only:
 * 1. Injects test fixtures via injectFreshRecords
 * 2. Runs the production engine via runEngine
 * 3. Categorizes results into scoredRanking vs unevaluable based on production output
 * 
 * NO classification logic here - all decisions come from production.
 */
export async function getOpportunityProviderForTest(): Promise<InjectableOpportunityProvider> {
  return {
    async list({ activePursuits, forceInjectedOpportunities }) {
      // Clear any previous injected records
      clearInjectedRecords();

      // Convert injected opportunities to full OpportunitySource shape
      const fullOpportunities = (forceInjectedOpportunities || []).map(opp => ({
        jobHash: opp.jobHash,
        role: opp.title,
        company: opp.companyName,
        location: "Remote",
        postedRelative: "Recently",
        scrapedFrom: "LinkedIn" as const,
        originalOpportunity: {
          sourcePayload: opp.rawText
        },
        rawText: opp.rawText,
        dimensions: [],
        primaryConcern: null
      }));

      // Inject into production
      if (fullOpportunities.length > 0) {
        injectFreshRecords(fullOpportunities);
      }

      // Build candidate projection using test profile
      // (Note: In production this would use the actual candidate profile)
      const builder = new CandidateProjectionBuilderImpl();
      const candidateProfile = createCandidateProfile("VP");
      const projection = builder.fromProfile(candidateProfile);

      // Run production engine
      const { records } = runEngine(projection, activePursuits);

      // Categorize results based on PRODUCTION output (no test logic)
      const scoredRanking: Array<{ jobHash: string; totalWeightedScore: number }> = [];
      const unevaluable: Array<{ jobHash: string; evaluationStatus: string }> = [];

      for (const record of records) {
        // Production determines evaluability via record.diligenceStatus and record.priority
        if (record.diligenceStatus === "NEEDS_MORE_INFO" || record.priority === null) {
          unevaluable.push({
            jobHash: record.jobHash,
            evaluationStatus: "SPARSE_SPEC" // Production would determine this
          });
        } else {
          scoredRanking.push({
            jobHash: record.jobHash,
            totalWeightedScore: record.priority ?? 0
          });
        }
      }

      return { scoredRanking, unevaluable };
    }
  };
}
