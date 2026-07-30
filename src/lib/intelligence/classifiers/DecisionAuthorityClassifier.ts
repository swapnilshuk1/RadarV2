import { ClassifierResult, DecisionAuthority } from "../../domain/semantic";

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(text);
}

export class DecisionAuthorityClassifier {
  public static classify(text: string, title: string): ClassifierResult<DecisionAuthority> {
    const textLower = `${title} ${text}`.toLowerCase();
    const titleLower = title.toLowerCase();
    const evidenceIds: string[] = [];

    // Explicit Title Hierarchy Booster
    const isExecutiveTitle = hasWord(titleLower, "head") || 
                             hasWord(titleLower, "director") || 
                             hasWord(titleLower, "vice president") || 
                             hasWord(titleLower, "vp") || 
                             hasWord(titleLower, "avp") || 
                             hasWord(titleLower, "gm") || 
                             hasWord(titleLower, "chief") || 
                             hasWord(titleLower, "cmo") || 
                             hasWord(titleLower, "cto") || 
                             hasWord(titleLower, "coo");

    // Cumulative 5-Dimensional Evidence Scoring
    let authorityPoints = 0;

    // 1. People Dimension
    const peopleKws = ["lead team", "manage team", "direct reports", "mentor", "hiring", "team management", "build team", "team leadership"];
    const matchedPeople = peopleKws.filter(kw => hasWord(textLower, kw));
    if (matchedPeople.length > 0) {
      authorityPoints++;
      evidenceIds.push("da_dim_people");
    }

    // 2. Budget & P&L Dimension
    const budgetKws = ["p&l", "budget", "roi", "ad spend", "revenue target", "financial discipline", "profitability"];
    const matchedBudget = budgetKws.filter(kw => hasWord(textLower, kw));
    if (matchedBudget.length > 0) {
      authorityPoints++;
      evidenceIds.push("da_dim_budget");
    }

    // 3. Strategy Dimension
    const strategyKws = ["strategy", "roadmap", "gtm", "go-to-market", "strategic planning", "business development", "vision"];
    const matchedStrategy = strategyKws.filter(kw => hasWord(textLower, kw));
    if (matchedStrategy.length > 0) {
      authorityPoints++;
      evidenceIds.push("da_dim_strategy");
    }

    // 4. Governance & Metrics Dimension
    const governanceKws = ["kpis", "metrics", "compliance", "sla", "governance", "executive reporting", "accountability"];
    const matchedGov = governanceKws.filter(kw => hasWord(textLower, kw));
    if (matchedGov.length > 0) {
      authorityPoints++;
      evidenceIds.push("da_dim_governance");
    }

    // 5. External & Stakeholder Dimension
    const externalKws = ["key clients", "stakeholders", "agencies", "board", "investors", "partnerships", "public relations"];
    const matchedExt = externalKws.filter(kw => hasWord(textLower, kw));
    if (matchedExt.length > 0) {
      authorityPoints++;
      evidenceIds.push("da_dim_external");
    }

    // Title boost
    if (isExecutiveTitle && authorityPoints < 2) {
      authorityPoints = 2; // Executive titles carry at least Functional authority
      evidenceIds.push("da_title_boost");
    }

    // Classification Mapping
    if (hasWord(textLower, "board") || hasWord(textLower, "ceo") || hasWord(textLower, "c-suite") || authorityPoints >= 5) {
      return { value: "ENTERPRISE", evidenceIds, confidence: 0.9 };
    }

    if (hasWord(textLower, "business unit") || hasWord(textLower, "bu") || hasWord(textLower, "division") || authorityPoints >= 3) {
      return { value: "BUSINESS_UNIT", evidenceIds, confidence: 0.85 };
    }

    if (authorityPoints >= 2) {
      return { value: "FUNCTION", evidenceIds, confidence: 0.8 };
    }

    if (authorityPoints === 1) {
      return { value: "TEAM", evidenceIds, confidence: 0.75 };
    }

    evidenceIds.push("da_default_self");
    return { value: "SELF", evidenceIds, confidence: 0.5 };
  }
}
