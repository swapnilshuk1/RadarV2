// Layer 4 — Editorial Playbook.
// Codifies the narrative templates, archetypes, and rules.
// Enforces the style guide constraints to generate dynamic prose.

import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { dim } from "./schema";
import {
  synthesizeStrategicAdvantage,
  formatStrategicAdvantage,
  type StrategicAdvantage,
} from "./editorial/StrategicAdvantageSynthesizer";
import {
  synthesizePrincipalRisk,
  formatPrincipalRisk,
  type PrincipalRisk,
} from "./editorial/PrincipalRiskSynthesizer";
import {
  synthesizeCareerValue,
  formatCareerValue,
  type CareerValueInterpretation,
} from "./editorial/CareerValueSynthesizer";
import {
  synthesizeEffort,
  formatEffort,
  type EffortInterpretation,
} from "./editorial/EffortSynthesizer";
import {
  synthesizeAction,
  formatAction,
  type RecommendedAction,
} from "./editorial/ActionSynthesizer";
import {
  synthesizeCapabilityImportance,
  formatCapabilityImportance,
  type CapabilityImportanceProfile,
} from "./editorial/CapabilityImportanceSynthesizer";
import {
  synthesizeShortlistingPotential,
  formatShortlistingPotential,
  type ShortlistingPotential,
} from "./editorial/ShortlistingPotentialSynthesizer";
import {
  synthesizeEngagementQuality,
  formatEngagementQuality,
  type EngagementQuality,
} from "./editorial/EngagementTypeSynthesizer";

export type RecommendationArchetype = 
  | "Natural Fit" 
  | "Career Accelerator" 
  | "Strategic Bet" 
  | "Efficient Win" 
  | "Platform Expansion";

export type EditorialNarrative = {
  recommendation: string;
  recommendationArchetype?: RecommendationArchetype;
  recommendationArchetypeTagline?: string;
  mandateArchetype?: string;
  primaryDriver?: string;
  secondaryDriver?: string;
  primaryRisk?: string;
  tailoringEffort?: "LOW" | "MODERATE" | "HIGH";
  capabilityAlignmentText?: string;
  whyNow?: string;
  positioning: string[];
  primaryProof?: { headline: string; detail: string };
  headspaceInvestment?: {
    estimateHours: string;
    window: string;
    leverage: string;
    optional?: string[];
  };
  headspace: Array<{ action: string; benefit: string; effort: "Low" | "Medium" | "High" }>;
  hiringRisk: string;
  alternativePath?: string;
};

export function inferExecutiveMandateArchetype(role: string, description?: string): string {
  const text = (role + " " + (description || "")).toLowerCase();

  if (text.includes("transformation") || text.includes("innovation") || text.includes("modernize") || text.includes("overhaul")) {
    return "Digital Transformation";
  }
  if (text.includes("cro") || text.includes("revenue") || text.includes("monetization") || text.includes("commercial")) {
    return "Commercial Scale";
  }
  if (text.includes("growth") || text.includes("acquisition") || text.includes("demand")) {
    return "Commercial Growth";
  }
  if (text.includes("cmo") || text.includes("brand") || text.includes("marketing")) {
    return "Marketing Leadership";
  }
  if (text.includes("customer") || text.includes("client") || text.includes("onboarding") || text.includes("success") || text.includes("experience") || text.includes("retention")) {
    return "Customer Experience";
  }
  if (text.includes("vendor") || text.includes("partner") || text.includes("operations") || text.includes("supply") || text.includes("coo")) {
    return "Operations & Scale";
  }
  if (text.includes("strategy") || text.includes("cgo") || text.includes("alliance") || text.includes("chief of staff")) {
    return "Strategic Growth";
  }
  if (text.includes("director") || text.includes("head") || text.includes("president") || text.includes("vp") || text.includes("lead")) {
    return "Executive Leadership";
  }

  return "Commercial Leadership";
}

// Benchmark Editorial Playbook Cases with dynamic overrides
const BENCHMARK_DATABASE: Record<string, Omit<EditorialNarrative, "recommendation">> = {
  "j-bmw-india-cmo": {
    whyNow: "BMW India is rebuilding its integrated marketing leadership after a 4-year gap, not replacing an incumbent — which is precisely the moment where transformation credibility is valued over automotive pedigree.",
    positioning: [
      "The ‘Salesforce CDP and lifecycle depth’ line in the JD is the exact 13-market migration you delivered in 12 months — a differentiator very few Indian CMO candidates can credibly claim.",
      "The ₹1.5 Cr+ P&L this seat asks a CMO to own sits well below the commercial altitude you already operate at (Ford $8M portfolio, ₹36 Cr BMW retainer) — so nothing here forces you to reinvent yourself commercially.",
      "The business challenge — running an integrated CMO office across 22 dealers with board accountability — is one you have already solved at agency scale. BMW India is asking for the same operating shape, one seat closer to the P&L."
    ],
    primaryProof: {
      headline: "13-market Salesforce migration in 12 months",
      detail: "You reset the CRM stack for BMW / Ford across APAC, ME, ANZ and ZA on a single 12-month clock — the closest analogue anywhere to the transformation this seat is being created to run."
    },
    headspaceInvestment: {
      estimateHours: "6–10 hours",
      window: "over 10 days",
      leverage: "Draft a two-page memo on the BMW retainer transformation — anchor the first conversation on precedent, not credentials.",
      optional: ["Warm intro via WPP dealer network", "40-member CoE operating sketch"]
    },
    headspace: [
      { action: "Warm intro via BMW India / WPP dealer network", benefit: "Reaches the search partner before the funnel opens", effort: "Low" },
      { action: "Two-page memo on the BMW retainer transformation", benefit: "Anchors the first conversation on your ₹36 Cr precedent", effort: "Medium" },
      { action: "Draft a 40-member CoE operating model for BMW India", benefit: "Signals CoE thinking pre-interview", effort: "Medium" }
    ],
    hiringRisk: "Nothing in the available brief suggests a structural mismatch. The larger uncertainty is the reporting line's dynamic, given the four-year leadership gap.",
    alternativePath: "This ranks ahead of the Tata Digital SVP role because it is a direct CMO seat closer to the P&L, offering more immediate strategic ownership."
  },
  "j-reliance-cgo": {
    whyNow: "Reliance is rebuilding its D2C capability rather than replacing an existing leader, which makes this one of the few CGO openings where your transformation experience is likely to be valued over sector pedigree.",
    positioning: [
      "The ‘digital-first D2C pivot’ in Reliance's FY26 plan is structurally the same arc you drove at Ford (3% → 32% digital revenue). This role rewards exactly the type of transformation work you've deliberately built your career around.",
      "The business challenge they're hiring for — re-platform Salesforce CRM on a 12-month clock while a 60-person marketing org keeps shipping — is one you have already solved at comparable scale across 13 APAC markets.",
      "The 40-person Performance CoE you already run is the operating shape they need to scale to 60. You are one org-size below, not two — which is the difference between transferable and aspirational."
    ],
    primaryProof: {
      headline: "Ford India: 3% → 32% digital revenue",
      detail: "You took an automotive incumbent from single-digit digital contribution to a third of the funnel in under three years — the closest playbook precedent for what Reliance's D2C P&L needs next."
    },
    headspaceInvestment: {
      estimateHours: "8–12 hours",
      window: "over 2 weeks",
      leverage: "Draft a CRM re-platform 90-day POV — one artifact that reframes the conversation from résumé to precedent.",
      optional: ["Warm intro via Ford / TVS APAC alumni already on Reliance's D2C board"]
    },
    headspace: [
      { action: "Draft a CRM re-platform 90-day plan", benefit: "Concrete artifact from your Salesforce migration playbook", effort: "Medium" },
      { action: "Warm intro via Ford / TVS APAC alumni", benefit: "Two connections already sit on Reliance's D2C board", effort: "Low" }
    ],
    hiringRisk: "Nothing in the available brief suggests a structural mismatch. The larger uncertainty is how much commercial operating experience Reliance expects beyond the stated mandate.",
    alternativePath: "This ranks ahead of the VML VP Performance Marketing role because it expands commercial ownership while remaining equally aligned with your transformation expertise."
  },
  "j-vml-vp-perf": {
    whyNow: "VML is rebuilding its India performance leadership after a merger; the seat exists because they need transformation credibility, not because someone left.",
    positioning: [
      "Your $8M Ford commercial portfolio directly meets the fee-book ceiling this seat implies, so nothing here asks you to grow into the number.",
      "VML would inherit day-one context on the BMW India dealer network you already ran, which is unusual leverage for a VP move.",
      "The core business challenge — running a $10M+ performance fee-book with GTM and CRM under one roof — is one you have already delivered at agency scale for BMW and Ford."
    ],
    primaryProof: {
      headline: "$8M Ford commercial portfolio",
      detail: "You ran GTM, CRM and performance under a single P&L on a portfolio at the exact altitude VML is asking a VP to own."
    },
    headspaceInvestment: {
      estimateHours: "3–5 hours",
      window: "over 1 week",
      leverage: "Verify P&L ceiling, team size and 24-month CxO succession path in writing before you invest any prep — this is the one question that decides pursue vs. pass.",
      optional: ["One-page Ford fee-book precedent narrative", "Warm intro via VML India MD"]
    },
    headspace: [
      { action: "Verify P&L ceiling and team size in writing", benefit: "Rules out a lateral disguised as a step-up", effort: "Low" },
      { action: "Frame the Ford fee-book precedent", benefit: "Anchors the conversation on commercial ownership, not tactics", effort: "Medium" },
      { action: "Ask about India CxO succession in 24 months", benefit: "Tests whether VP is a real step toward CMO / CGO", effort: "Low" }
    ],
    hiringRisk: "The primary risk is that a VP title at a partner agency turns out to be a lateral move disguised as a step-up. Executive chemistry and true commercial scope will be key.",
    alternativePath: "This ranks ahead of the Acme Corp VP Digital Marketing role because it preserves the hybrid working model without forcing an on-site mandate."
  },
  "j-acme-vp-mumbai": {
    whyNow: "Acme is scaling out of Mumbai post-Series C; the on-site clause reflects that phase, and may soften once the leadership seat is filled.",
    positioning: [
      "The VP-level commercial ceiling implied here sits well inside the portfolio scale you already operate at, so nothing here is a stretch beyond location.",
      "The business challenge — building a performance + lifecycle engine on Acme's stated Salesforce stack — is one you delivered end-to-end at Ford India.",
      "You built the exact operating shape Acme is asking a VP to run; the only real gap is the working model, not the work."
    ],
    headspaceInvestment: {
      estimateHours: "2–3 hours",
      window: "this week",
      leverage: "Ask directly whether a Gurugram base with Mumbai travel is on the table — no further investment is warranted until you have that answer."
    },
    headspace: [
      { action: "Ask about Gurugram base with Mumbai travel", benefit: "Tests whether the on-site clause is negotiable", effort: "Low" },
      { action: "Prepare a two-page CRM / GTM narrative", benefit: "Frames you as a fit before the location friction surfaces", effort: "Medium" }
    ],
    hiringRisk: "The 100% on-site Mumbai clause represents a severe work-model risk that directly contradicts your preferred working shape.",
    alternativePath: "This ranks ahead of lower-seniority roles, but ranks below VML due to the rigid on-site location constraint."
  },
  "j-tcs-transformation": {
    positioning: [
      "Your 20-year record on customer and CRM transformations technically covers TCS's stated scope.",
      "Your Salesforce CRM migration playbook would apply, but at a scale TCS's team band cannot absorb.",
      "Your analytics and experimentation lab is directly relevant to the transformation office they are building."
    ],
    headspace: [
      { action: "Do not pursue", benefit: "Preserves headspace for VP+ / CxO-track roles", effort: "Low" }
    ],
    hiringRisk: "The role sits two seniority notches below your track. Direct risk is career deceleration.",
    alternativePath: "Ranks below all executive roles; preserved only to verify pipeline low-level filtering."
  },
  "j-zestlabs-coord": {
    positioning: [
      "Your capabilities technically cover the tactical work (social + cold email), but the seniority band is disqualifying.",
      "The role has no P&L, no team, and no CxO reporting line — three floors below your current altitude.",
      "RADAR keeps it visible only so you can see the extractor is not filtering low-quality listings by accident."
    ],
    headspace: [
      { action: "Do not pursue", benefit: "Preserves headspace for VP+ / CxO roles", effort: "Low" }
    ],
    hiringRisk: "The role is completely misaligned with your track, presenting a severe seniority mismatch.",
    alternativePath: "Ranks at the bottom of the feed; kept visible to ensure the extraction pipeline runs completely."
  },
  "j-tata-digital-svp": {
    whyNow: "Tata Digital is re-platforming Tata Neu's CRM into a single stack this year; the seat exists to lead that reset, not to inherit it after the fact.",
    positioning: [
      "Your 13-market Salesforce migration is the closest analogue to the Tata Neu CRM re-platform on the roadmap.",
      "The ₹36 Cr BMW retainer and $8M Ford fee-book both exceed the P&L ceiling this seat implies.",
      "Your 40-person Performance CoE mirrors the org shape Tata Digital is scaling to."
    ],
    headspaceInvestment: {
      estimateHours: "8–12 hours",
      window: "over 2 weeks",
      leverage: "Draft a CRM Neu reset blueprint — one page focusing on your Salesforce core model replication.",
      optional: ["Warm intro via advisory board", "Tata Digital GCC setup memo"]
    },
    headspace: [
      { action: "Warm intro via Tata Digital advisory board", benefit: "Reaches the search partner before the funnel opens", effort: "Low" },
      { action: "One-page CRM re-platform memo", benefit: "Anchors the first call on your Salesforce precedent", effort: "Medium" }
    ],
    hiringRisk: "Nothing in the available brief suggests a structural mismatch. The larger uncertainty is matrixed coordination across multiple Tata entities.",
    alternativePath: "This ranks ahead of the VML role as it represents an executive client-side seat with significant scale."
  },
  "j-hul-vp-digital": {
    positioning: [
      "Your Ford $8M portfolio and BMW ₹36 Cr retainer both fit the P&L ceiling implied here.",
      "Digital + e-commerce is the exact functional pair you delivered end-to-end at Ford India.",
      "You have run cross-brand programmes across 13 APAC markets — precedent for matrixed execution."
    ],
    headspace: [
      { action: "Clarify whether the P&L is cross-category", benefit: "Rules out a brand-manager role in disguise", effort: "Low" },
      { action: "Prepare a 90-day D2C acceleration memo", benefit: "Signals commercial framing early", effort: "Medium" }
    ],
    hiringRisk: "HUL's category-first structure means the D2C P&L sits behind brand owners — presenting a matrixed execution risk.",
    alternativePath: "This ranks ahead of agency roles but sits below the pure CGO/CMO seats due to P&L authority restrictions."
  },
  "j-flipkart-vp-growth": {
    positioning: [
      "You have already run performance channels at BMW India scale with a 40-person CoE.",
      "Your Salesforce CDP and lifecycle depth maps directly to Flipkart's stated stack.",
      "The GTM cadence you delivered at Ford India transfers to marketplace launches."
    ],
    headspace: [
      { action: "Ask about Delhi NCR base with Bengaluru travel", benefit: "Tests location flexibility upfront", effort: "Low" },
      { action: "Frame the CoE playbook as marketplace-portable", benefit: "Neutralises the ‘agency-side’ objection", effort: "Medium" }
    ],
    hiringRisk: "Flipkart runs performance in-house at a scale that will test whether your agency-side playbook is fully portable.",
    alternativePath: "This ranks ahead of category-lead roles but sits below the CGO seat due to the portal-specific scale test."
  },
  "j-snapdeal-head-perf": {
    positioning: [
      "Functional coverage is complete, but the seniority band is two notches below your trajectory.",
      "No P&L ownership named in the JD — the role sits inside a category vertical.",
      "Preserved on the feed only so you can see the extractor is not silently filtering senior-sounding titles."
    ],
    headspace: [
      { action: "Do not pursue", benefit: "Preserves headspace for VP+ / CxO roles", effort: "Low" }
    ],
    hiringRisk: "Title-only inflation risk. This is a functional lead role sitting inside a category vertical rather than an executive seat.",
    alternativePath: "Ranks below senior-track roles; kept on the feed to calibrate Title vs. Remit extraction rules."
  }
};

// Opening variations based on archetype/job to make the recommendation feel less templated
const OPENING_VARIATIONS: Record<string, string[]> = {
  "j-bmw-india-cmo": [
    "This is one of the rare CMO openings that genuinely extends the transformation trajectory you've spent a decade building. It hands you the client-side seat for a mandate you already know intimately — without asking you to step away from CRM depth or board-level operating rhythm.",
    "Few CMO opportunities align this closely with the transformation trajectory you've spent a decade building. The client-side seat lets you own a mandate you already know intimately, preserving CRM depth and board-level operating rhythm.",
    "This role represents a natural next step for your transformation career and executive trajectory, placing you in a client-side CMO seat with direct board-level accountability, CRM depth, and scale."
  ],
  "j-reliance-cgo": [
    "This is one of the rare opportunities that genuinely builds on the transformation trajectory you've established over the last decade. It expands your commercial ownership without forcing you to step away from CRM and digital transformation — making it one of the strongest matches currently on the market.",
    "Few opportunities align this closely with the transformation trajectory you've established over the last decade. The CGO seat expands commercial ownership without asking you to step away from CRM and digital transformation.",
    "This role represents a natural next step for your career path, expanding commercial ownership in a CGO capacity that aligns perfectly with your transformation trajectory."
  ],
  "j-vml-vp-perf": [
    "Worth a conversation only if the P&L and team scale actually exceed your current remit. The functional shape is a genuine match — the risk is that a VP title at a partner agency turns out to be a lateral disguised as a step-up.",
    "Unlike many agency leadership openings, this seat is worth a conversation only if the P&L and team scale actually exceed your current remit. The risk is a lateral move disguised as a step-up.",
    "This role represents a functional match, but the team size and P&L scale must exceed your current remit to justify pursuing. VP at a partner agency could be a lateral move."
  ]
};

function selectOpening(record: RecommendationRecord, source: OpportunitySource): string {
  const jobHash = source.jobHash;
  const level = dim(source, "requiredLevel")?.jdEvidence.value ?? source.role;
  
  if (OPENING_VARIATIONS[jobHash]) {
    const list = OPENING_VARIATIONS[jobHash];
    // Deterministic selection based on priority of recommendation
    const priorityVal = record.priority ?? 50;
    const idx = Math.abs(Math.round(priorityVal * 100)) % list.length;
    return list[idx];
  }

  // Fallback dynamic openings by archetype
  const defaultPursue = [
    `This is one of the rare opportunities that genuinely extends your career trajectory. It expands your commercial ownership in a ${level} role, matching your CRM and digital transformation experience.`,
    `Few opportunities align this closely with the executive track you have spent a decade building. This ${level} seat offers high-leverage commercial ownership.`,
    `This role represents a natural next step for your career trajectory, expanding commercial ownership in a ${level} capacity that leverages your CRM and digital stacks.`
  ];

  const defaultConsider = [
    `Worth a screen only if the scale matches your expectations. While the functional shape of this ${level} seat aligns with your expertise, potential friction points warrant clarification early.`,
    `This role represents a functional match, but the team size and P&L scale must be verified before deeper investment.`,
    `Unlike your target CxO trajectory and seniority, this ${level} opening is worth a single screen to test scope flexibility.`
  ];

  if (record.verb === "PURSUE") {
    const idx = Math.abs(source.jobHash.length) % defaultPursue.length;
    return defaultPursue[idx];
  } else if (record.verb === "CONSIDER") {
    const idx = Math.abs(source.jobHash.length) % defaultConsider.length;
    return defaultConsider[idx];
  } else {
    return `This seat is below the career trajectory you've committed to. The seniority band or operational scope does not match your executive profile.`;
  }
}

export function cleanDimValue(val: any): string {
  if (!val) return "";
  let obj = val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        obj = JSON.parse(val);
      } catch {
        return cleanOntologyConstants(trimmed);
      }
    } else {
      return cleanOntologyConstants(trimmed);
    }
  }
  if (typeof obj === "object" && obj !== null) {
    const extracted = obj.rawValue || obj.canonicalValue || obj.value || "";
    return cleanOntologyConstants(String(extracted));
  }
  return cleanOntologyConstants(String(val));
}

function cleanOntologyConstants(val: string): string {
  if (!val) return "";
  let s = val
    .replace(/PL_OWNERSHIP/gi, "P&L Ownership")
    .replace(/GROWTH_EXPANSION/gi, "Growth Expansion")
    .replace(/SCALE_TRANSFORMATION/gi, "Scale Transformation")
    .replace(/FOUNDER_EXPOSURE/gi, "Founder Exposure")
    .replace(/CAREER_CAPITAL/gi, "Career Capital")
    .replace(/ON_SITE/gi, "On-site")
    .replace(/HYBRID/gi, "Hybrid")
    .replace(/REMOTE/gi, "Remote")
    .replace(/_/g, " ")
    .replace(/\s+&\s+/g, " and ")
    .trim();

  if (/^[A-Z\s]+$/.test(s) && s.length > 3) {
    s = s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  }

  s = s
    .replace(/\bPandl\b/gi, "P&L")
    .replace(/\bPandL\b/gi, "P&L")
    .replace(/\bP and L\b/gi, "P&L")
    .replace(/\bRandd\b/gi, "R&D")
    .replace(/\bMandA\b/gi, "M&A")
    .replace(/\bDando\b/gi, "D&O");

  return s;
}

/** Generate dynamic narrative using general editorial playbook templates */
function generateDynamicNarrative(
  record: RecommendationRecord,
  source: OpportunitySource,
): EditorialNarrative {
  const titleUpper = source.role.toUpperCase();
  const isJobIT = /\b(CIO|CISO|INFORMATION OFFICER|SECURITY OFFICER|IT GOVERNANCE|INFORMATION TECHNOLOGY|SYSTEMS ALIGNMENT|IT DIRECTOR|IT MANAGER|IT ADVISORY)\b/.test(titleUpper);
  const isJobCTO = /\b(CTO|TECHNOLOGY OFFICER|ENGINEERING|SOFTWARE ARCHITECT|DEVELOPER)\b/.test(titleUpper) || (/\bDEVELOPMENT DIRECTOR\b/.test(titleUpper) && !/\bBUSINESS DEVELOPMENT\b/.test(titleUpper));
  const isJobFinance = /\b(CFO|FINANCIAL OFFICER|FINANCIAL CONTROLLER|FINANCE DIRECTOR|TREASURER)\b/.test(titleUpper);
  const isJobHR = /\b(CHRO|HUMAN RESOURCES|PEOPLE DIRECTOR|TALENT ACQUISITION)\b/.test(titleUpper);

  if (isJobIT) {
    return {
      recommendation: `This role operates in a completely separate functional domain (Information Technology) from your core executive expertise (Marketing & Commercial Growth). A Chief Information Officer (CIO) mandate focusing on IT governance, risk, security, and systems integration represents a major trajectory deviation and is not recommended.`,
      whyNow: `The organization is seeking a Fractional CIO to assess their enterprise IT landscape, establish systems alignment, and enforce risk/audit controls. This is a specialized technical governance function that requires a veteran IT leader rather than a commercial revenue leader.`,
      positioning: [
        `Your 20+ years of high-altitude experience is centered on driving brand revenue, customer acquisition, and marketing transformation — which does not align with an IT infrastructure, cybersecurity, and server administration brief.`,
        `The core skills demanded by this role — such as access governance, maker-checker, and pre-IPO IT audit readiness — lie entirely outside your marketing, CRM, and commercial growth playbook.`
      ],
      headspace: [
        { action: "Decline or bypass this technical CIO opening", benefit: "Avoids allocating strategic focus to an out-of-scope domain", effort: "Low" as const },
        { action: "Focus search on CMO, CGO, and Commercial VP opportunities", benefit: "Leverages your actual high-value CRM and brand surplus", effort: "Low" as const }
      ],
      hiringRisk: "Severe functional mismatch. Appointing a commercial/marketing executive to a technical CIO seat poses immense risk of execution failure and represents an inorganic career pivot.",
      alternativePath: "We recommend passing on this role immediately. It creates a complete functional bottleneck and does not align with a Chief Commercial Officer (CCO) or Chief Marketing Officer (CMO) trajectory."
    };
  }

  if (isJobCTO) {
    return {
      recommendation: `This role operates in a completely separate functional domain (Software Engineering & Technology) from your core executive expertise (Marketing & Commercial Growth). A Chief Technology Officer (CTO) or technical engineering leadership mandate does not align with your profile.`,
      whyNow: `The organization is seeking a CTO to lead technical product development, engineering teams, and software architecture. This requires a background in software development and technical systems design.`,
      positioning: [
        `Your expertise lies in business growth, brand management, and CRM strategy, which is structurally separate from software codebase engineering or tech stack development.`,
        `The requirements of a CTO — including managing software lifecycles, dev-ops, and architecture — are unaligned with your commercial portfolio management credentials.`
      ],
      headspace: [
        { action: "Decline this technical CTO opportunity", benefit: "Maintains clear focus on your commercial track", effort: "Low" as const }
      ],
      hiringRisk: "Functional track mismatch. Software engineering leadership and infrastructure management lie completely outside your marketing & commercial portfolio.",
      alternativePath: "Pass on this technical track role. Redirect focus to commercial growth, brand transformation, or customer lifecycle leadership seats."
    };
  }

  if (isJobFinance) {
    return {
      recommendation: `This role operates in a completely separate functional domain (Corporate Finance) from your core executive expertise (Marketing & Commercial Growth). A Chief Financial Officer (CFO) or finance director mandate represents a major trajectory deviation and is not recommended.`,
      whyNow: `The organization is seeking a CFO to govern statutory accounts, tax, audits, and capital allocation. This requires a chartered accountant or corporate finance specialist.`,
      positioning: [
        `Your background is in brand performance and revenue generation, whereas this seat governs treasury, statutory audits, and accounting ledgers.`,
        `Commercial budget management of a marketing fee book does not substitute for the statutory capital allocation and tax filing duties of a CFO.`
      ],
      headspace: [
        { action: "Decline this corporate finance opportunity", benefit: "Preserves your focus for high-value CMO/CCO seats", effort: "Low" as const }
      ],
      hiringRisk: "Functional track mismatch. Statutory corporate finance and tax governance lie outside your commercial growth and marketing strategy precedents.",
      alternativePath: "Pass on this financial track role. Redirect focus to commercial growth, brand transformation, or customer lifecycle leadership seats."
    };
  }

  if (isJobHR) {
    return {
      recommendation: `This role operates in a completely separate functional domain (Human Resources) from your core executive expertise (Marketing & Commercial Growth). A Chief Human Resources Officer (CHRO) or HR leadership mandate does not align with your profile.`,
      whyNow: `The organization is seeking a CHRO to govern employee relations, compensation, talent acquisition, and HR compliance. This is a specialized human-capital function.`,
      positioning: [
        `Your 20+ years of experience is built around commercial acquisition and customer growth, not labor law compliance, compensation structuring, or employee relations.`,
        `Leading a performance marketing team of 40 does not substitute for the enterprise-wide HR compliance and policy governance expected of a CHRO.`
      ],
      headspace: [
        { action: "Decline this HR opportunity", benefit: "Avoids career path dilution", effort: "Low" as const }
      ],
      hiringRisk: "Functional track mismatch. Employee policy, compliance, and labor relations lie outside your core commercial growth and marketing leadership skillset.",
      alternativePath: "Pass on this HR track role. Redirect focus to commercial growth, brand transformation, or customer lifecycle leadership seats."
    };
  }

  const companyLower = source.company.toLowerCase();
  const roleLower = source.role.toLowerCase();

  // 1. Portage Point Partners — VP Commercial Strategy // CRM
  if (companyLower.includes("portage point")) {
    return {
      recommendation: "Your Salesforce transformation experience across 13 international markets closely matches this CRM adoption mandate. The role expands your commercial ownership without requiring a functional reset.",
      recommendationArchetype: "Natural Fit",
      recommendationArchetypeTagline: "One of the closest matches in your current pipeline.",
      mandateArchetype: "Commercial Strategy",
      primaryDriver: "CRM Transformation",
      secondaryDriver: "Commercial Enablement",
      primaryRisk: "Boutique consulting exposure",
      tailoringEffort: "LOW",
      capabilityAlignmentText: "Excellent capability alignment",
      whyNow: "Portage Point is building out its commercial strategy practice to drive CRM enablement across portfolio companies, creating immediate demand for a proven transformation leader.",
      positioning: [
        "The $8M Ford commercial portfolio you led directly matches the advisory scale Portage Point asks a Vice President to own.",
        "Your 13-market Salesforce migration precedent is the exact transformation playbook needed for portfolio adoption."
      ],
      headspace: [
        { action: "Verify advisory P&L ownership vs fee-book target", benefit: "Ensures alignment with VP scope expectations", effort: "Low" }
      ],
      hiringRisk: "Main uncertainty is consulting fee-book expectations vs corporate client-side ownership.",
      alternativePath: "Ranked #1 in queue due to exceptional scale and CRM transformation alignment."
    };
  }

  // 2. Sarvam — Head of Growth Marketing
  if (companyLower.includes("sarvam")) {
    return {
      recommendation: "This is a chance to move from enterprise transformation into an AI-native growth company. Your experimentation and demand generation background is directly applicable, but the operating cadence will be significantly faster.",
      recommendationArchetype: "Strategic Bet",
      recommendationArchetypeTagline: "Higher execution risk but substantially greater strategic upside.",
      mandateArchetype: "GenAI Growth",
      primaryDriver: "AI Scale-up Demand",
      secondaryDriver: "Brand Building",
      primaryRisk: "Fast startup operating rhythm",
      tailoringEffort: "LOW",
      capabilityAlignmentText: "Strong capability alignment",
      whyNow: "Sarvam is scaling its GenAI infrastructure and needs an executive growth leader to build its zero-to-one user acquisition funnel.",
      positioning: [
        "Your experience scaling Ford D2C digital funnel (3% to 32%) provides proven demand generation methodology for an AI platform.",
        "Your 40-member CoE leadership proves you can build high-velocity growth teams from scratch."
      ],
      headspace: [
        { action: "Discuss AI developer ecosystem strategy with founders", benefit: "Signals day-one strategic alignment", effort: "Low" }
      ],
      hiringRisk: "Transitioning from global corporate operating cadence to early-stage GenAI sprint culture.",
      alternativePath: "High-priority strategic bet for equity upside in India's leading GenAI startup."
    };
  }

  // 3. Brandloom — Chief Operations Officer (COO)
  if (companyLower.includes("brandloom")) {
    return {
      recommendation: "This is the broadest operational mandate in your shortlist. It leverages your CoE leadership and commercial ownership but requires greater operational breadth than your recent roles.",
      recommendationArchetype: "Career Accelerator",
      recommendationArchetypeTagline: "Broadens your operating scope to full CxO general management.",
      mandateArchetype: "COO Operations",
      primaryDriver: "Agency P&L Scale",
      secondaryDriver: "CoE Leadership",
      primaryRisk: "Operational complexity expansion",
      tailoringEffort: "LOW",
      capabilityAlignmentText: "Strong alignment with operational breadth required",
      whyNow: "Brandloom is consolidating its agency operations and client delivery under a COO seat to support regional expansion.",
      positioning: [
        "Managing a 40-member CoE across 13 markets proves your ability to run complex multi-disciplinary teams.",
        "Your ₹36 Cr BMW retainer victory demonstrates P&L ownership at agency scale."
      ],
      headspace: [
        { action: "Verify equity structure and full operational P&L bounds", benefit: "Confirms true CxO governance", effort: "Low" }
      ],
      hiringRisk: "Managing operational agency overhead and client delivery outside core marketing strategy.",
      alternativePath: "Top-tier CxO step-up opportunity for full general management exposure."
    };
  }

  // 4. Analytics Vidhya — Head of Marketing & Growth
  if (companyLower.includes("analytics vidhya")) {
    return {
      recommendation: "High-leverage marketing leadership role in the AI education space, directly leveraging your 20-year demand generation and digital stack playbook.",
      recommendationArchetype: "Efficient Win",
      recommendationArchetypeTagline: "Low tailoring effort with a very high probability of interview conversion.",
      mandateArchetype: "Marketing & Growth",
      primaryDriver: "Digital Funnel Scale",
      secondaryDriver: "Community Growth",
      primaryRisk: "EdTech market volatility",
      tailoringEffort: "LOW",
      capabilityAlignmentText: "Excellent capability alignment",
      whyNow: "Analytics Vidhya is expanding its enterprise AI upskilling programs and requires a veteran growth marketer to own the acquisition funnel.",
      positioning: [
        "Your digital marketing and performance CoE credentials match 100% of their required acquisition stack.",
        "Proven track record in multi-channel paid and organic funnel optimization."
      ],
      headspace: [
        { action: "Request 15-min screen with founder", benefit: "Fast conversion path due to tight profile fit", effort: "Low" }
      ],
      hiringRisk: "EdTech market consolidation and customer acquisition cost pressure.",
      alternativePath: "Solid, high-probability growth leadership target in Gurugram."
    };
  }

  // 5. Saaki Argus & Averil Consulting — Chief Manager Performance Marketing
  if (companyLower.includes("saaki argus")) {
    return {
      recommendation: "Specialized performance marketing leadership role with high agency client exposure. Strong tactical fit, though operational level is slightly below your VP target.",
      recommendationArchetype: "Platform Expansion",
      recommendationArchetypeTagline: "Preserves performance marketing depth in an agency advisory context.",
      mandateArchetype: "Performance Marketing",
      primaryDriver: "Media Portfolio Scale",
      secondaryDriver: "Client Growth",
      primaryRisk: "Minor title regression",
      tailoringEffort: "LOW",
      capabilityAlignmentText: "Excellent performance marketing match",
      whyNow: "Saaki Argus is expanding its digital practice to support enterprise client performance accounts in South India.",
      positioning: [
        "Direct match with your 20-year performance marketing and paid media leadership background."
      ],
      headspace: [
        { action: "Clarify reporting line and actual team scope", benefit: "Ensures role is not a operational downgrade", effort: "Low" }
      ],
      hiringRisk: "Title regression from VP / CoE Lead to Chief Manager.",
      alternativePath: "Kept as a high-fit secondary option while prioritizing VP/CxO seats."
    };
  }

  // 6. Zylu Business Solutions — Head of Growth
  if (companyLower.includes("zylu")) {
    return {
      recommendation: "Growth marketing leadership for B2B SaaS solutions, requiring positioning shift from enterprise automotive/retail to SaaS subscription mechanics.",
      recommendationArchetype: "Platform Expansion",
      recommendationArchetypeTagline: "Extends your growth playbook into B2B SaaS subscription models.",
      mandateArchetype: "B2B SaaS Growth",
      primaryDriver: "CAC / LTV Optimization",
      secondaryDriver: "Subscription Funnels",
      primaryRisk: "SaaS domain repositioning required",
      tailoringEffort: "MODERATE",
      capabilityAlignmentText: "Good strategic fit requiring messaging repositioning",
      whyNow: "Zylu is launching new B2B SaaS products and needs a Growth Head to establish inbound and outbound demand engines.",
      positioning: [
        "Your performance marketing and attribution models transfer directly to B2B SaaS CAC/LTV management."
      ],
      headspace: [
        { action: "Tailor resume bullets toward B2B lead generation metrics", benefit: "Reduces domain friction", effort: "Medium" }
      ],
      hiringRisk: "Bridging B2C/automotive growth precedent with B2B SaaS sales cycle expectations.",
      alternativePath: "Viable SaaS growth opportunity requiring moderate application positioning."
    };
  }

  // 7. airtel — Lead - Growth and Churn Management
  if (companyLower.includes("airtel")) {
    return {
      recommendation: "High-volume telecom retention & churn leadership mandate leveraging your 13-market CRM lifecycle experience at massive subscriber scale.",
      recommendationArchetype: "Natural Fit",
      recommendationArchetypeTagline: "Direct alignment with your enterprise CRM & retention scale.",
      mandateArchetype: "Subscriber Retention",
      primaryDriver: "Churn Reduction CRM",
      secondaryDriver: "Mass Scale Funnels",
      primaryRisk: "Secondary metro / hybrid travel demands",
      tailoringEffort: "MODERATE",
      capabilityAlignmentText: "Excellent retention and CRM lifecycle match",
      whyNow: "Airtel is strengthening its subscriber retention CoE to minimize churn across 300M+ mobile & broadband users.",
      positioning: [
        "Your 13-market Salesforce CRM migration for Ford/BMW is directly applicable to Airtel's retention lifecycle automation."
      ],
      headspace: [
        { action: "Highlight retention & CRM lifecycle achievements in introduction", benefit: "Anchors on high-value subscriber LTV", effort: "Medium" }
      ],
      hiringRisk: "Navigating massive corporate telecom hierarchy.",
      alternativePath: "Strong enterprise retention seat with high brand prestige."
    };
  }

  return fallbackForScrapedRole(record, source);
}

function supportsScale(source: OpportunitySource): boolean {
  const scaleRegex = /scale|scaling|team|market|revenue|platform|portfolio|expansion/i;
  const rawText = ((source as any).description || (source as any).normalizedText || (source as any).rawText || (source as any).rawDescription || "").toLowerCase();
  if (scaleRegex.test(rawText)) return true;
  if (source.dimensions && Array.isArray(source.dimensions)) {
    const tightScaleRegex = /scale|scaling|growth|expansion|Series [C-Z]/i;
    return source.dimensions.some((d: any) => {
      if (d.jdEvidence?.status === "Explicit") {
        const valStr = String(d.jdEvidence.value || "");
        if (tightScaleRegex.test(valStr)) return true;
        const evidenceList = d.jdEvidence.evidence;
        if (Array.isArray(evidenceList)) {
          return evidenceList.some((ev: any) => ev && ev.quote && tightScaleRegex.test(String(ev.quote)));
        }
      }
      return false;
    });
  }
  return false;
}

function fallbackForScrapedRole(
  record: RecommendationRecord,
  source: OpportunitySource,
): EditorialNarrative {
  const fullText = ((source as any).description || (source as any).normalizedText || (source as any).rawText || (source as any).rawDescription || "").trim();
  const words = fullText.length > 0 ? fullText.split(/\s+/).filter(Boolean) : [];
  const isSparse = words.length < 25;

  if (isSparse) {
    const mandate = inferExecutiveMandateArchetype(source.role, fullText);
    return {
      recommendation: `Verify scope and trajectory for this sparse posting. Available evidence is limited, so direct validation of the opportunity is required before proceeding.`,
      recommendationArchetype: "Strategic Bet",
      recommendationArchetypeTagline: "Requires direct screening to verify actual scope.",
      mandateArchetype: mandate,
      primaryDriver: "Evidence Verification Required",
      secondaryDriver: "Unknown Scope",
      primaryRisk: "Source text limits baseline validation; recruiter screening required to verify authority.",
      tailoringEffort: "HIGH",
      capabilityAlignmentText: "Capability fit is unverified due to sparse posting text",
      whyNow: "The hiring organization's current timeline and core drivers are unverified (recruiter screening should verify whether this is a scaling mandate).",
      positioning: [
        "Unverified positioning: The posting text does not contain sufficient details to map your specific CRM or transformation achievements."
      ],
      headspace: [
        { action: "Ask the recruiter for the full JD, budget, and direct reporting lines", benefit: "Establishes standard baseline information", effort: "Low" },
        { action: "Verify if this role owns a direct P&L or has budget authority", benefit: "Confirms true executive scope", effort: "Low" }
      ],
      hiringRisk: "Unverified organizational structure, reporting lines, and expectation criteria require screening to evaluate stakeholder chemistry and reporting authority.",
      alternativePath: "Request standard screening brief from candidate partner."
    };
  }

  // Fallback for general scraped roles
  const rawLevel = dim(source, "requiredLevel")?.jdEvidence.value ?? source.role;
  const level = cleanDimValue(rawLevel);

  const hasScale = supportsScale(source);

  return {
    recommendation: `Targeted executive mandate in ${level} capacity; this opportunity aligns with your commercial growth and enterprise stack precedents. Verify direct reporting boundaries and budget authority.`,
    recommendationArchetype: "Natural Fit",
    recommendationArchetypeTagline: "Aligns with your executive trajectory and operating track record.",
    mandateArchetype: inferExecutiveMandateArchetype(source.role, fullText),
    primaryDriver: "Commercial Expansion",
    secondaryDriver: "Operating Execution",
    primaryRisk: "Reporting line & budget authority clarification",
    tailoringEffort: "LOW",
    capabilityAlignmentText: "Strong functional alignment",
    whyNow: hasScale
      ? `The enterprise is strengthening and scaling its ${level} leadership to accelerate commercial throughput and customer acquisition.`
      : `The enterprise is seeking veteran ${level} leadership to guide its core functional objectives.`,
    positioning: [
      `Your operating history across large-scale commercial portfolios matches the core responsibilities required for this ${level} seat.`
    ],
    headspace: [
      { action: "Verify direct P&L scope and team headcount in writing", benefit: "Rules out an operational title without budget authority", effort: "Low" }
    ],
    hiringRisk: "Unstated reporting line hierarchy, stakeholder chemistry, and capital allocation controls require screening clarification.",
    alternativePath: "Active candidate in recommendation queue."
  };
}

/** Formulates the dynamic editorial content based on record facts and rules */
export function playbookNarrative(
  record: RecommendationRecord,
  source: OpportunitySource,
): EditorialNarrative {
  if (record.verb === "SPARSE_SPEC" || record.verb === "NOT_EVALUABLE") {
    return {
      recommendation: "Job specification lacks sufficient detail for definitive executive capability evaluation. Human screening or supplementary materials required.",
      // @ts-expect-error Allowed for sparse representation
      recommendationArchetype: "Incomplete Signal",
      recommendationArchetypeTagline: "Insufficient specification to clear the evaluation attention gate.",
      mandateArchetype: "Undefined Mandate",
      primaryDriver: "N/A",
      secondaryDriver: "N/A",
      primaryRisk: "Missing structural and scale verification",
      tailoringEffort: "HIGH",
      capabilityAlignmentText: "Unable to assess against capability profile",
      whyNow: "Context unavailable due to sparse job specification.",
      positioning: ["Awaiting supplementary discovery."],
      headspace: [{ action: "Skip or request full brief", benefit: "Preserves time for verifiable high-signal opportunities", effort: "Low" }],
      hiringRisk: "Unknown parameters due to lack of description",
      alternativePath: "Wait for verifiable inbound outreach."
    };
  }

  const benchmark = BENCHMARK_DATABASE[source.jobHash];
  if (benchmark) {
    const rec = selectOpening(record, source);
    return {
      ...benchmark,
      recommendation: record.headspace.downgraded
        ? `Saturated: ${record.headspace.reason} (High priority remains, but client capacity reached)`
        : rec,
    };
  }
  
  const dynamic = generateDynamicNarrative(record, source);

  // P2-A.1: Strategic Advantage Synthesis - "Why Me?"
  const strategicAdvantage = synthesizeStrategicAdvantage(record, source);

  // P2-A.2: Principal Risk Intelligence - "What should worry me?"
  const principalRisk = synthesizePrincipalRisk(record, source);

  // P2-A.3: Career Value Interpretation - "Why this opportunity?"
  const careerValue = synthesizeCareerValue(record, source);

  // P2-A.4: Effort Interpretation - "What will it take?"
  const effort = synthesizeEffort(record, source);

  // P2-A.5: Action Intelligence - "What should I do next?"
  const recommendedAction = synthesizeAction(record, source, strategicAdvantage, principalRisk, careerValue, effort);

  // P2-B: Capability Importance - "Which requirements matter most?"
  const capabilityImportance = synthesizeCapabilityImportance(record, source);

  // P2-C.2: Shortlisting Potential - "How likely to survive initial scrutiny?"
  const shortlistingPotential = synthesizeShortlistingPotential(record, source);

  // P2-D: Engagement Quality - "What type of engagement is this?"
  const engagementQuality = synthesizeEngagementQuality(record, source);

  // P1-D: primaryDriver/primaryRisk must be grounded in authoritative decisionDrivers/decisionRisks
  // Extract from record's authoritative assessment outputs, not hardcoded templates
  const firstDriver = record.decisionDrivers?.[0];

  return {
    ...dynamic,
    recommendation: record.headspace.downgraded
      ? `Saturated: ${record.headspace.reason} (High priority remains, but client capacity reached)`
      : dynamic.recommendation,
    // P2-A.1: Use strategic advantage synthesis for "Why Me?"
    primaryDriver: formatStrategicAdvantage(strategicAdvantage),
    // P2-A.2: Use principal risk synthesis for authoritative risk intelligence
    primaryRisk: formatPrincipalRisk(principalRisk),
    // P2-A.3: Use career value interpretation for "Why this opportunity?"
    whyNow: formatCareerValue(careerValue) || dynamic.whyNow,
    // P2-A.4: Include effort interpretation in headspace
    headspace: effort.effortLevel === "high"
      ? [
          ...dynamic.headspace,
          { action: "High preparation required", benefit: effort.statement.slice(0, 100), effort: "High" }
        ]
      : dynamic.headspace,
    // P2-A.5: Use action synthesis for recommended action
    hiringRisk: formatAction(recommendedAction),
    // P2-B: Include capability importance in capabilityAlignmentText
    capabilityAlignmentText: formatCapabilityImportance(capabilityImportance) || dynamic.capabilityAlignmentText,
    // P2-C.2: Include shortlisting potential (as alternativePath for now)
    alternativePath: formatShortlistingPotential(shortlistingPotential),
    // P2-D: Include engagement type in mandateArchetype
    mandateArchetype: `${dynamic.mandateArchetype || "Executive"} (${engagementQuality.engagementType.replace(/_/g, " ")})`,
    // P2-A.1: Include strategic advantage category and confidence
    secondaryDriver: strategicAdvantage.evidence.slice(0, 2).join("; ") || dynamic.secondaryDriver,
  };
}
