// Layer 4 — Editorial Playbook.
// Codifies the narrative templates, archetypes, and rules.
// Enforces the style guide constraints to generate dynamic prose.

import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { dim } from "./schema";

export type EditorialNarrative = {
  recommendation: string;
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
    "This role represents a natural next step for your transformation career, placing you in a client-side CMO seat with direct board-level accountability, CRM depth, and scale."
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
    const idx = Math.abs(Math.round(record.priority * 100)) % list.length;
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
    `Unlike your target CxO seats, this ${level} opening is worth a single screen to test scope flexibility.`
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

/** Generate dynamic narrative using general editorial playbook templates */
function generateDynamicNarrative(
  record: RecommendationRecord,
  source: OpportunitySource,
): EditorialNarrative {
  const level = dim(source, "requiredLevel")?.jdEvidence.value ?? source.role;
  const mandate = dim(source, "mandate")?.jdEvidence.value ?? "";
  const commercial = dim(source, "commercialAccountability")?.jdEvidence.value ?? "";
  
  const recommendation = selectOpening(record, source);

  // Rule 2: "Why Now" describes the business moment (timing/rebuilding).
  const whyNow = `The business is scaling its ${mandate || "digital growth channels"} after a recent transformation shift, which makes this a key moment for an executive who can scale capability without friction.`;

  // Rule 3: Positioning starts with company challenge first, sorted descending by impact score.
  const positioning = [
    { text: `The commercial scope of the role (${commercial || "enterprise scale"}) aligns with your portfolio management credentials.`, score: 10 },
    { text: `The business challenge they need to solve — ${mandate || "scaling CRM and digital stacks"} — matches the transformation playbook you've already delivered.`, score: 9 },
    { text: `You have already run equivalent execution teams, making the operational shape a direct match.`, score: 8 }
  ]
    .sort((a, b) => b.score - a.score)
    .map(p => p.text);

  const headspace = [
    { action: "Verify operational scope and P&L authority", benefit: "Ensures alignment with your seniority target", effort: "Low" as const },
    { action: "Clarify tech stack and CRM modernization plans", benefit: "Ensures the mandate is genuinely transformational", effort: "Medium" as const }
  ];

  return {
    recommendation,
    whyNow,
    positioning,
    headspace,
    hiringRisk: "The job description doesn't reveal a meaningful concern at this stage. That usually shifts to executive chemistry during interviews.",
    alternativePath: `This ranks ahead of lower-priority roles due to stronger alignment with your strategic preferences.`
  };
}

/** Formulates the dynamic editorial content based on record facts and rules */
export function playbookNarrative(
  record: RecommendationRecord,
  source: OpportunitySource,
): EditorialNarrative {
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
  return {
    ...dynamic,
    recommendation: record.headspace.downgraded
      ? `Saturated: ${record.headspace.reason} (High priority remains, but client capacity reached)`
      : dynamic.recommendation,
  };
}
