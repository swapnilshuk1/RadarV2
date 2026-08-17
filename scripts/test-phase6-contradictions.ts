/**
 * RADAR V4 Phase 6 — Adversarial Contradiction & Invariant Corpus
 *
 * Tests Cases A through H against the live BriefCompositionEngine.compose() pipeline.
 */

import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import type { Opportunity } from "../src/data/opportunity-fixtures";

export interface AdversarialCase {
  id: string;
  name: string;
  opportunity: Opportunity;
  expectedVerdict: "PURSUE" | "CONSIDER" | "PASS";
  expectedNarrativeTone: "cautious" | "positive" | "pass" | "sparse";
  prohibitedPhrases: RegExp[];
  requiredSignals?: string[];
}

export const ADVERSARIAL_CASES: AdversarialCase[] = [
  {
    id: "CASE-A-DOMAIN-MISMATCH",
    name: "Domain Mismatch with Strong Incidental Capability",
    opportunity: {
      jobHash: "adv-case-a",
      role: "VP Engineering & Cloud Infrastructure",
      company: "CloudScale Systems",
      location: "Bengaluru",
      decision: "PASS",
      dimensions: [
        {
          key: "functionalScope",
          bucket: "DomainMismatch",
          jdEvidence: { status: "Explicit", value: "Software Infrastructure & Cloud Architecture", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-a",
        evaluationFingerprint: "v4.3",
        engineVerdict: "PASS",
        vetoed: true,
        vetoReason: "R-VETO-FUNCTIONAL-DISTANCE",
        qualityScore: null,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-VETO-FUNCTIONAL-DISTANCE"],
        decisionRisks: [
          {
            factor: "Domain Divergence",
            severity: "Critical",
            evidence: "Role requires deep software engineering & kernel architecture beyond commercial executive scope",
          },
        ],
        decisionDrivers: [],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "PASS",
    expectedNarrativeTone: "pass",
    prohibitedPhrases: [/perfect functional fit/i, /direct domain match/i, /seamless execution/i],
  },
  {
    id: "CASE-B-DOMAIN-MATCH",
    name: "Direct Domain Match with Positive Alignment",
    opportunity: {
      jobHash: "adv-case-b",
      role: "Chief Growth Officer",
      company: "Apex Consumer Tech",
      location: "Mumbai",
      decision: "PURSUE",
      recommendationResult: { score: 92 },
      dimensions: [
        {
          key: "mandate",
          bucket: "DirectMatch",
          jdEvidence: { status: "Explicit", value: "Commercial Growth & Digital Modernization", evidence: [] },
        },
        {
          key: "commercialAccountability",
          bucket: "FullPL",
          jdEvidence: { status: "Explicit", value: true, evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-b",
        evaluationFingerprint: "v4.3",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 92,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-PURSUE-DIRECT-FIT"],
        decisionRisks: [],
        decisionDrivers: [{ factor: "Direct P&L and growth alignment", impact: "High" }],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "PURSUE",
    expectedNarrativeTone: "positive",
    prohibitedPhrases: [/domain divergence/i, /structural regression/i, /strategic pass/i],
    requiredSignals: ["PURSUE"],
  },
  {
    id: "CASE-C-CORE-MANDATE-GAP",
    name: "Core Mandate Gap with Adjacent Transferability",
    opportunity: {
      jobHash: "adv-case-c",
      role: "VP Operations & Supply Chain",
      company: "Logix Global",
      location: "Gurugram",
      decision: "CONSIDER",
      recommendationResult: { score: 62 },
      dimensions: [
        {
          key: "mandate",
          bucket: "Adjacent",
          jdEvidence: { status: "Inferred", value: "Supply Chain & Physical Logistics", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-c",
        evaluationFingerprint: "v4.3",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 62,
        parsingConfidence: 0.75,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-ADJACENT-MANDATE"],
        decisionRisks: [
          {
            factor: "Mandate Precedent Gap",
            severity: "High",
            evidence: "Direct operational precedent in physical warehouse logistics is limited",
          },
        ],
        decisionDrivers: [{ factor: "Strong executive leadership and scale", impact: "Medium" }],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "CONSIDER",
    expectedNarrativeTone: "cautious",
    prohibitedPhrases: [/unqualified core match/i, /proven track record in physical warehouse logistics/i],
  },
  {
    id: "CASE-D-CORE-MANDATE-ALIGNMENT",
    name: "Core Mandate Direct Alignment",
    opportunity: {
      jobHash: "adv-case-d",
      role: "VP Digital Marketing & Acquisition",
      company: "FinScale Online",
      location: "Bengaluru",
      decision: "PURSUE",
      recommendationResult: { score: 88 },
      dimensions: [
        {
          key: "mandate",
          bucket: "DirectMatch",
          jdEvidence: { status: "Explicit", value: "Performance Marketing & Customer Acquisition", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-d",
        evaluationFingerprint: "v4.3",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 88,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-PURSUE-DIRECT-FIT"],
        decisionRisks: [],
        decisionDrivers: [{ factor: "Direct performance marketing alignment", impact: "High" }],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "PURSUE",
    expectedNarrativeTone: "positive",
    prohibitedPhrases: [/mandate gap/i, /precedent is limited/i],
  },
  {
    id: "CASE-E-COMBINED-CONTRADICTION",
    name: "Combined Domain Mismatch and Mandate Gap with High Synthetic Score",
    opportunity: {
      jobHash: "adv-case-e",
      role: "Head of Legal & Regulatory Affairs",
      company: "BioPharma Corp",
      location: "Hyderabad",
      decision: "PASS",
      recommendationResult: { score: 85 }, // artificially high score
      dimensions: [
        {
          key: "functionalScope",
          bucket: "DomainMismatch",
          jdEvidence: { status: "Explicit", value: "Corporate Law & Clinical Compliance", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-e",
        evaluationFingerprint: "v4.3",
        engineVerdict: "PASS",
        vetoed: true,
        vetoReason: "R-VETO-FUNCTIONAL-DISTANCE",
        qualityScore: null,
        parsingConfidence: 0.85,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-VETO-FUNCTIONAL-DISTANCE"],
        decisionRisks: [
          { factor: "Domain Mismatch", severity: "Critical", evidence: "Requires Bar license & Legal domain expertise" },
        ],
        decisionDrivers: [],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "PASS",
    expectedNarrativeTone: "pass",
    prohibitedPhrases: [/pursue this opportunity/i, /strong commercial fit/i, /high strategic fit/i],
  },
  {
    id: "CASE-F-LEGITIMATE-STRATEGIC-ADVANTAGE",
    name: "Legitimate Strategic Advantage in Transformation",
    opportunity: {
      jobHash: "adv-case-f",
      role: "Chief Digital Officer (CDO)",
      company: "Heritage Enterprise Ltd",
      location: "Mumbai",
      decision: "PURSUE",
      recommendationResult: { score: 90 },
      dimensions: [
        {
          key: "mandate",
          bucket: "Transformation",
          jdEvidence: { status: "Explicit", value: "Enterprise Digital Modernization & CRM Overhaul", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-f",
        evaluationFingerprint: "v4.3",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 90,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-PURSUE-TRANSFORMATION-FIT"],
        decisionRisks: [],
        decisionDrivers: [{ factor: "Enterprise CRM & Digital Transformation", impact: "High" }],
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "PURSUE",
    expectedNarrativeTone: "positive",
    prohibitedPhrases: [/domain divergence/i, /strategic pass/i],
  },
  {
    id: "CASE-G-NEGATIVE-POLICY-CONTROL",
    name: "Negative Policy Control (Easy Trap / Career Value Protection)",
    opportunity: {
      jobHash: "adv-case-g",
      role: "Senior Marketing Manager",
      company: "MidMarket SaaS",
      location: "Bengaluru",
      decision: "CONSIDER",
      recommendationResult: { score: 88, policyId: "R-CONSIDER-CAREER-VALUE-PROTECTION" },
      dimensions: [
        {
          key: "functionalScope",
          bucket: "AccessibleJunior",
          jdEvidence: { status: "Explicit", value: "B2B Marketing & Campaign Management", evidence: [] },
        },
      ],
      engineRecommendation: {
        jobHash: "adv-case-g",
        evaluationFingerprint: "v4.3",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 88,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        decisionRisks: [
          {
            factor: "Career Trajectory Deceleration",
            severity: "High",
            evidence: "High match accessibility but lateral/downward altitude relative to VP level",
          },
        ],
        decisionDrivers: [{ factor: "High accessibility match", impact: "Medium" }],
        relativeDifferentiator: "High accessibility but material career regression detected.",
        trajectoryUpside: "Limited Career Upside",
        opportunityScoreConfidence: "HIGH",
        opportunityScoreSource: "EXPLICIT",
      },
    } as any,
    expectedVerdict: "CONSIDER",
    expectedNarrativeTone: "cautious",
    prohibitedPhrases: [/career acceleration/i, /strongest commercial transformation/i],
    requiredSignals: ["interview probability", "limited career step-up"],
  },
  {
    id: "CASE-H-DEFERRED-EVALUATION",
    name: "Deferred Evaluation (SPARSE_SPEC / NOT_EVALUABLE)",
    opportunity: {
      jobHash: "adv-case-h",
      role: "Commercial Director",
      company: "Stealth Startup",
      location: "Remote",
      decision: "PASS",
      effectiveDecision: "NOT_EVALUABLE",
      recommendationResult: { score: null },
      dimensions: [],
      engineRecommendation: {
        jobHash: "adv-case-h",
        evaluationFingerprint: "v4.3",
        engineVerdict: "SPARSE_SPEC" as any,
        vetoed: false,
        vetoReason: "SPARSE_SPEC",
        qualityScore: null,
        parsingConfidence: 0.2,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-DEFER-SPARSE-SPEC"],
        decisionRisks: [{ factor: "Missing JD Data", severity: "Critical", evidence: "Job description is too sparse to evaluate" }],
        decisionDrivers: [],
        opportunityScoreConfidence: "LOW",
        opportunityScoreSource: "FALLBACK",
      },
    } as any,
    expectedVerdict: "PASS",
    expectedNarrativeTone: "sparse",
    prohibitedPhrases: [/exceptional capability coverage/i, /proven authority/i],
  },
];

export async function runAdversarialCorpus() {
  console.log("================================================================================");
  console.log("     RADAR V4 PHASE 6 — ADVERSARIAL CONTRADICTION & INVARIANT AUDIT SUITE       ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  for (const tc of ADVERSARIAL_CASES) {
    const brief = BriefCompositionEngine.compose(tc.opportunity, { bypassHistory: true });
    let casePassed = true;
    const errors: string[] = [];

    // Check Verdict
    if (brief.memory.decision !== tc.expectedVerdict) {
      casePassed = false;
      errors.push(`Verdict mismatch: Expected ${tc.expectedVerdict}, got ${brief.memory.decision}`);
    }

    const fullProse = [
      brief.memory.headline,
      brief.memory.primaryOpportunity,
      brief.memory.primaryRisk,
      brief.memory.recommendedAction,
      brief.oneMinuteTLDR.bottomLine,
      ...brief.oneMinuteTLDR.whyPursue,
      ...brief.oneMinuteTLDR.watchFor,
      brief.executiveOpinion || "",
    ].join(" ");

    // Check Prohibited Phrases
    for (const regex of tc.prohibitedPhrases) {
      if (regex.test(fullProse)) {
        casePassed = false;
        errors.push(`Contradiction Violation: Prose matched prohibited regex ${regex}`);
      }
    }

    // Check Required Signals
    if (tc.requiredSignals) {
      for (const sig of tc.requiredSignals) {
        if (!fullProse.includes(sig)) {
          casePassed = false;
          errors.push(`Missing Required Signal: Prose missing "${sig}"`);
        }
      }
    }

    if (casePassed) {
      passed++;
      console.log(`✅ [PASS] ${tc.id}: ${tc.name}`);
      console.log(`         Verdict: ${brief.memory.decision} | Headline: "${brief.memory.headline}"`);
    } else {
      failed++;
      console.log(`❌ [FAIL] ${tc.id}: ${tc.name}`);
      errors.forEach((e) => console.log(`         - ${e}`));
    }
  }

  console.log("\n================================================================================");
  console.log(` ADVERSARIAL CORPUS RESULT: ${failed === 0 ? "🟢 ALL CASES PASSED" : "🔴 FAILED"}`);
  console.log(` Passed: ${passed} | Failed: ${failed}`);
  console.log("================================================================================\n");

  return { passed, failed };
}

runAdversarialCorpus().then(({ failed }) => {
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error("Adversarial run error:", err);
  process.exit(1);
});
