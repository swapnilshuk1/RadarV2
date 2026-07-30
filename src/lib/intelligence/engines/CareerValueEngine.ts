import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { CareerValueBreakdown, DimensionHeuristic } from "../../domain/semantic";

export class CareerValueEngine {
  public static evaluate(candidate: CandidateProjection, job: JobProjection): CareerValueBreakdown {
    // 1. Title Progression
    let titleProgression: DimensionHeuristic = { value: 0.5, reason: "Lateral Move", status: "KNOWN" };
    const jobOperatingLevel = job.operatingLevel?.value || "UNKNOWN";
    const candidateOperatingLevel = candidate.operatingLevel?.value || "UNKNOWN";
    
    if (jobOperatingLevel === "EXECUTIVE" && candidateOperatingLevel !== "EXECUTIVE") {
      titleProgression = { value: 0.9, reason: `Promotion to ${jobOperatingLevel}`, status: "KNOWN" };
    } else if (jobOperatingLevel === candidateOperatingLevel) {
      titleProgression = { value: 0.7, reason: `Lateral ${jobOperatingLevel}`, status: "KNOWN" };
    } else {
      titleProgression = { value: 0.2, reason: `Title Regression to ${jobOperatingLevel}`, status: "KNOWN" };
    }

    // 2. Scope Expansion
    let scopeExpansion: DimensionHeuristic = { value: 0.5, reason: "Similar Scope", status: "KNOWN" };
    const jobWorkNature = job.workNature?.value || "UNKNOWN";
    const candidateWorkNature = candidate.workNature?.value || "UNKNOWN";
    if (jobWorkNature === "EXECUTIVE_WORK" && candidateWorkNature !== "EXECUTIVE_WORK") {
      scopeExpansion = { value: 0.85, reason: "Transition to Executive Management", status: "KNOWN" };
    } else if (jobWorkNature === "EXECUTIVE_WORK") {
      scopeExpansion = { value: 0.8, reason: "Continued Executive Scope", status: "KNOWN" };
    }

    // 3. Commercial Scale
    let commercialScale: DimensionHeuristic = { value: 0.5, reason: "Unknown Commercial Accountability", status: "UNKNOWN" };
    const jobCommercialScope = job.commercialScope?.value || "UNKNOWN";
    
    // Explicit hierarchical check based on text logic (since parsed budget might be missing)
    const rawText = (job.originalOpportunity?.rawText || "").toLowerCase();
    if (rawText.includes("p&l") || rawText.includes("profit and loss")) {
      commercialScale = { value: 0.95, reason: "Explicit P&L or Revenue Responsibility", status: "KNOWN" };
    } else if (rawText.includes("budget ownership") || rawText.includes("manage budget")) {
      commercialScale = { value: 0.85, reason: "Budget Ownership", status: "KNOWN" };
    } else if (jobCommercialScope === "ENTERPRISE") {
      commercialScale = { value: 0.9, reason: "Enterprise-wide Commercial Scope", status: "KNOWN" };
    } else if (jobCommercialScope === "PORTFOLIO" || rawText.includes("portfolio")) {
      commercialScale = { value: 0.8, reason: "Portfolio or Business-Unit Ownership", status: "KNOWN" };
    } else if (rawText.includes("team of") || rawText.includes("direct reports")) {
      commercialScale = { value: 0.75, reason: "Organizational Team Size Scope", status: "KNOWN" };
    } else if (jobCommercialScope === "PRODUCT") {
      commercialScale = { value: 0.7, reason: "Product-level Commercials", status: "KNOWN" };
    } else if (jobCommercialScope === "NONE") {
      commercialScale = { value: 0.3, reason: "Cost Center / No Commercial Scope", status: "KNOWN" };
    }

    // 4. Brand Signal
    let brandSignal: DimensionHeuristic = { value: 0.5, reason: "Brand metadata unavailable", status: "UNKNOWN" };
    const companyContext = (job as any).companyContext;
    if (companyContext && companyContext.maturityScore) {
      const companyScore = companyContext.maturityScore;
      if (companyScore > 80) brandSignal = { value: 0.9, reason: "Tier 1 Brand Signal", status: "KNOWN" };
      else if (companyScore > 60) brandSignal = { value: 0.75, reason: "Strong Market Player", status: "KNOWN" };
      else brandSignal = { value: 0.4, reason: "Weak or Niche Brand", status: "KNOWN" };
    }

    // 5. Future Optionality
    // Calculate via adjacency, capability breadth, seniority, reputation, etc.
    let futureOptionality: DimensionHeuristic = { value: 0.6, reason: "Standard Progression (Evolving Heuristic)", status: "ESTIMATED" };
    const jobCaps = job.capabilities || [];
    const capabilitiesBroadened = jobCaps.length > candidate.coreCapabilities.length;
    
    if (jobOperatingLevel === "EXECUTIVE" && commercialScale.value >= 0.85) {
      futureOptionality = { value: 0.95, reason: "Path to CEO/Board (High Strategic Exposure)", status: "ESTIMATED" };
    } else if (capabilitiesBroadened && titleProgression.value >= 0.7) {
      futureOptionality = { value: 0.85, reason: "Capability Portability & Seniority Progression", status: "ESTIMATED" };
    } else if (brandSignal.value >= 0.75) {
      futureOptionality = { value: 0.8, reason: "High Employer Reputation lifts future optionality", status: "ESTIMATED" };
    } else if (titleProgression.value < 0.5) {
      futureOptionality = { value: 0.4, reason: "Title regression limits immediate external optionality", status: "ESTIMATED" };
    }

    return {
      titleProgression,
      scopeExpansion,
      commercialScale,
      brandSignal,
      futureOptionality
    };
  }
}
