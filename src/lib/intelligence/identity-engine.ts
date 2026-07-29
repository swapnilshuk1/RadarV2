import { 
  type CandidateState, 
  type CandidateIdentity, 
  type ExtractedFact, 
  type CandidateClaim, 
  type UserSession,
  type CareerIntentSession,
  type EvidenceSource
} from "../../types/candidate";

export class IdentityEngine {
  /**
   * Dynamic compiler: takes raw flat extracted facts from Gemini and compiles
   * them into structured claims, capabilities, leadership, and scores.
   */
  public static compile(
    session: UserSession,
    sources: EvidenceSource[],
    facts: ExtractedFact[],
    intent: CareerIntentSession
  ): CandidateState {
    const claims: CandidateClaim[] = [];
    
    // Group facts by subject/theme to synthesize logical claims
    const factsBySubject: Record<string, ExtractedFact[]> = {};
    facts.forEach(fact => {
      const key = fact.subject || "General Experience";
      if (!factsBySubject[key]) factsBySubject[key] = [];
      factsBySubject[key].push(fact);
    });

    Object.entries(factsBySubject).forEach(([subject, subFacts], index) => {
      claims.push({
        id: `claim-auto-${index}`,
        type: "Capability",
        title: subject,
        statement: subFacts.map(f => f.predicate).join(" Also, ") + ".",
        supportingFactIds: subFacts.map(f => f.id),
        confidence: parseFloat((subFacts.reduce((sum, f) => sum + f.confidence, 0) / subFacts.length).toFixed(2)),
        lastUpdated: new Date().toISOString()
      });
    });

    // Compile capabilities category dictionary dynamically
    const categories: Record<string, string[]> = {
      growth: [],
      crm: [],
      analytics: [],
      transformation: []
    };

    facts.forEach(f => {
      const pred = f.predicate.toLowerCase();
      if (pred.includes("grow") || pred.includes("revenue") || pred.includes("acquisition") || pred.includes("marketing")) {
        categories.growth.push(f.subject);
      }
      if (pred.includes("crm") || pred.includes("salesforce") || pred.includes("hubspot")) {
        categories.crm.push(f.subject);
      }
      if (pred.includes("analytics") || pred.includes("data") || pred.includes("experiment") || pred.includes("attribution")) {
        categories.analytics.push(f.subject);
      }
      if (pred.includes("transform") || pred.includes("turnaround") || pred.includes("operating model") || pred.includes("coe")) {
        categories.transformation.push(f.subject);
      }
    });

    // Deduplicate capabilities
    Object.keys(categories).forEach(k => {
      categories[k] = Array.from(new Set(categories[k].filter(Boolean)));
    });

    // Extract numerical metrics for leadership
    let largestTeam = 10;
    let budgetScale = "$1M";
    let boardExposure = false;
    let globalMarketsCount = 1;

    facts.forEach(f => {
      const pred = f.predicate.toLowerCase();
      const teamMatch = pred.match(/(\d+)\s*[- ]\s*member|team of (\d+)/);
      if (teamMatch) {
        const size = parseInt(teamMatch[1] || teamMatch[2]);
        if (size > largestTeam) largestTeam = size;
      }
      const budgetMatch = pred.match(/\$(\d+)\s*m/);
      if (budgetMatch) {
        budgetScale = `$${budgetMatch[1]}M`;
      }
      if (pred.includes("board") || pred.includes("ceo") || pred.includes("executive committee")) {
        boardExposure = true;
      }
      const marketMatch = pred.match(/(\d+)\s*(markets|countries|regions)/);
      if (marketMatch) {
        const count = parseInt(marketMatch[1]);
        if (count > globalMarketsCount) globalMarketsCount = count;
      }
    });

    const achievements = facts.map(f => `${f.subject}: ${f.predicate}`);
    const quantifiedOutcomes = achievements.filter(ach => /\d+[%$M]/i.test(ach)).length;

    // Build backwards compatible evidence array for scoring engines
    const legacyEvidence = claims.map(cl => ({
      type: cl.title,
      proof: cl.statement
    }));

    // Emergent archetype based on capabilities strength
    let archetype = "Executive Leader";
    if (categories.growth.length > categories.transformation.length) {
      archetype = "Commercial Growth Leader";
    } else if (categories.transformation.length > 0) {
      archetype = "Digital Transformation Partner";
    }

    const compiledIdentity: CandidateIdentity = {
      identity: {
        archetype,
        valueProposition: claims.map(c => c.statement).slice(0, 2).join(" "),
        executiveThemes: ["Transformation", "Commercial", "Growth", "Leadership"].slice(0, 3)
      },
      capabilities: {
        categories
      },
      leadership: {
        largestTeam,
        budgetScale,
        boardExposure,
        globalMarketsCount
      },
      evidence: legacyEvidence,
      achievements,
      identityConfidence: Math.min(100, Math.round(70 + facts.length * 2.5)),
      evidenceCount: facts.length,
      quantifiedOutcomesCount: quantifiedOutcomes
    };

    const newState: CandidateState = {
      version: "1.0.0",
      session,
      sources,
      facts,
      claims,
      identity: compiledIdentity,
      intent,
      updatedAt: new Date().toISOString()
    };

    return newState;
  }
}
