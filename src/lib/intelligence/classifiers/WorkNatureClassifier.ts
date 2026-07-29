// src/lib/intelligence/classifiers/WorkNatureClassifier.ts

import { ClassifierResult, WorkNature } from "../../domain/semantic";

export class WorkNatureClassifier {
  public static classify(text: string, title: string): ClassifierResult<WorkNature> {
    const textLower = `${title} ${text}`.toLowerCase();
    const evidenceIds: string[] = [];

    // Parse distinct responsibility segments
    const segments = textLower.split(/[.\n•\-\*]/).map(s => s.trim()).filter(s => s.length > 5);

    let execScore = 0;
    let strategicScore = 0;
    let managerScore = 0;
    let tacticalScore = 0;
    let specialistScore = 0;

    segments.forEach(segment => {
      // 1. Executive Work: P&L, Board, Capital Allocation, Organization-wide transform
      const hasPL = segment.includes("p&l") || segment.includes("profit and loss") || segment.includes("profit & loss");
      const hasBoard = segment.includes("board") || segment.includes("managing director") || segment.includes("c-suite") || segment.includes("md &") || segment.includes("md +");
      const hasExecWords = segment.includes("allocate investment") || segment.includes("govern") || segment.includes("acquisition") || segment.includes("merger") || segment.includes("scale capability") || segment.includes("build organization");

      if (hasPL || hasBoard || hasExecWords) {
        execScore += 2; // High weight for executive indicators
        evidenceIds.push(`wn_exec_${segment.slice(0, 20).replace(/[^a-z0-9]/g, "_")}`);
      }

      // 2. Strategic Work: Strategy, GTM, Positioning, Operating Models, Roadmaps
      const hasStrategy = segment.includes("strategy") || segment.includes("gtm") || segment.includes("positioning") || segment.includes("roadmap") || segment.includes("design operating") || segment.includes("market expansion");
      if (hasStrategy) {
        strategicScore += 2;
        evidenceIds.push(`wn_strat_${segment.slice(0, 20).replace(/[^a-z0-9]/g, "_")}`);
      }

      // 3. Managerial Work: Resource planning, coordination, hiring, people leadership
      const hasMgr = segment.includes("hiring") || segment.includes("people") || segment.includes("performance management") || segment.includes("resource planning") || segment.includes("cross-team") || segment.includes("coordinate");
      if (hasMgr) {
        managerScore += 1.5;
        evidenceIds.push(`wn_mgr_${segment.slice(0, 20).replace(/[^a-z0-9]/g, "_")}`);
      }

      // 4. Tactical Work: Campaign execution, QA, backlog, daily stand-up, scrum, templates
      const hasTactical = segment.includes("campaign execution") || segment.includes("qa") || segment.includes("sprint") || segment.includes("backlog") || segment.includes("stand-up") || segment.includes("scrum") || segment.includes("file upload") || segment.includes("email deployment");
      if (hasTactical) {
        tacticalScore += 2;
        evidenceIds.push(`wn_tac_${segment.slice(0, 20).replace(/[^a-z0-9]/g, "_")}`);
      }

      // 5. Specialist Work: Discrete technical delivery (coding, copywriting, manual CSS editing)
      const hasSpecialist = segment.includes("coding") || segment.includes("copywriting") || (segment.includes("css") && !segment.includes("sfmc")) || segment.includes("writing templates");
      if (hasSpecialist) {
        specialistScore += 2;
        evidenceIds.push(`wn_spec_${segment.slice(0, 20).replace(/[^a-z0-9]/g, "_")}`);
      }
    });

    const maxScore = Math.max(execScore, strategicScore, managerScore, tacticalScore, specialistScore);

    if (maxScore === 0) {
      const tLower = title.toLowerCase();
      if (tLower.includes("head") || tLower.includes("vp") || tLower.includes("chief") || tLower.includes("director")) {
        return { value: "STRATEGIC_WORK", evidenceIds: ["wn_title_strategic"], confidence: 0.7 };
      }
      if (tLower.includes("manager") || tLower.includes("lead")) {
        return { value: "MANAGERIAL_WORK", evidenceIds: ["wn_title_managerial"], confidence: 0.65 };
      }
      if (tLower.includes("representative") || tLower.includes("executive") || tLower.includes("specialist")) {
        return { value: "TACTICAL_WORK", evidenceIds: ["wn_title_tactical"], confidence: 0.6 };
      }
      evidenceIds.push("wn_fallback_default");
      return { value: "UNKNOWN", evidenceIds, confidence: 0.0 };
    }

    if (maxScore === execScore) {
      return { value: "EXECUTIVE_WORK", evidenceIds, confidence: 0.9 };
    }
    if (maxScore === strategicScore) {
      return { value: "STRATEGIC_WORK", evidenceIds, confidence: 0.9 };
    }
    if (maxScore === managerScore) {
      return { value: "MANAGERIAL_WORK", evidenceIds, confidence: 0.85 };
    }
    if (maxScore === tacticalScore) {
      return { value: "TACTICAL_WORK", evidenceIds, confidence: 0.9 };
    }
    return { value: "SPECIALIST_WORK", evidenceIds, confidence: 0.85 };
  }

  /**
   * Refined 3-Axis Structured Work Nature classification.
   * Returns independent situation, context, and pattern tags.
   */
  public static classifyStructured(text: string, title: string): {
    situation: ("TURNAROUND" | "HYPERGROWTH" | "CRISIS" | "STABILIZATION")[];
    context: ("GREENFIELD" | "M_AND_A" | "DIVESTITURE" | "PE_BACKED")[];
    pattern: ("STRATEGIC_TRANSFORMATION" | "OPERATIONAL_SCALING" | "ADVISORY")[];
  } {
    const textLower = `${title} ${text}`.toLowerCase();
    
    const situation: ("TURNAROUND" | "HYPERGROWTH" | "CRISIS" | "STABILIZATION")[] = [];
    if (/turnaround|restructure|distressed|margin recovery/i.test(textLower)) situation.push("TURNAROUND");
    if (/hypergrowth|scale 10x|rapid expansion/i.test(textLower)) situation.push("HYPERGROWTH");
    if (/stabiliz|crisis|decline recovery/i.test(textLower)) situation.push("STABILIZATION");

    const context: ("GREENFIELD" | "M_AND_A" | "DIVESTITURE" | "PE_BACKED")[] = [];
    if (/greenfield|0 to 1|0-to-1|launch division/i.test(textLower)) context.push("GREENFIELD");
    if (/m&a|merger|acquisition|post-merger|pmi/i.test(textLower)) context.push("M_AND_A");
    if (/divestiture|carve-out|spin-off/i.test(textLower)) context.push("DIVESTITURE");
    if (/pe-backed|private equity|lbo|value creation plan/i.test(textLower)) context.push("PE_BACKED");

    const pattern: ("STRATEGIC_TRANSFORMATION" | "OPERATIONAL_SCALING" | "ADVISORY")[] = [];
    if (/transform|operating model|re-platform|moderniz/i.test(textLower)) pattern.push("STRATEGIC_TRANSFORMATION");
    if (/scale|expand|grow team|increase capacity/i.test(textLower)) pattern.push("OPERATIONAL_SCALING");
    if (/advisor|steering|board advisor|consult/i.test(textLower)) pattern.push("ADVISORY");

    // Fallbacks if empty
    if (situation.length === 0) situation.push("HYPERGROWTH");
    if (context.length === 0) context.push("GREENFIELD");
    if (pattern.length === 0) pattern.push("STRATEGIC_TRANSFORMATION");

    return { situation, context, pattern };
  }
}
