import type { CandidateProfile } from "../../src/domain/candidate";

/** Deliberately synthetic profile for deterministic engine/certification tests. */
export const syntheticCandidateProfile: CandidateProfile = {
  identity: { name: "Test Candidate", currentTitle: "VP Marketing" },
  executiveIdentity: { archetype: "Functional VP", valueProposition: "Leads measurable growth and transformation", executiveThemes: ["Growth", "Transformation", "Commercial"] },
  experience: { yearsExperience: 15, teamSizeManaged: 40, feeBookScale: "$8M", plOwnership: true, boardInteraction: true, achievements: ["Built a 40 person marketing team", "Led an $8M growth portfolio"] },
  evidence: [{ type: "Leadership", proof: "Led a 40 person team and an $8M portfolio." }],
  capabilities: { growth: ["Growth Strategy", "Performance Marketing"], crm: ["CRM Strategy"], analytics: ["Marketing Analytics"], transformation: ["Digital Transformation"] },
  executiveCompetencies: ["Commercial Leadership", "Team Building", "Strategic Planning"], semanticAliases: {},
  preferences: { locations: ["Bengaluru", "Gurugram"], remote: "Hybrid", targetMinSalary: "₹1.5 Cr", industries: ["Technology", "Automotive"] },
  industryExperience: { primary: ["Technology"], secondary: ["Automotive"], enterprise: ["Global Enterprise"] },
  strategy: { targetTitles: ["VP Marketing", "Chief Marketing Officer"], ceoPathway: false, boardReadiness: true },
  resume: { rawText: "Synthetic executive marketing leader with fifteen years of growth, CRM, and transformation experience." },
  platforms: ["Salesforce Marketing Cloud"], skills: ["Growth Strategy", "CRM Strategy"], functions: ["Marketing", "Growth"], domains: ["Technology"], leadership: ["Commercial Leadership"],
};
