/**
 * Deterministic domain and capability lexicon. This is the boundary Mantle
 * reasons inside: employer identity and domain compatibility are never decided
 * by a model.
 */

import type { DimensionKind, Domain } from "./types";

interface DomainDef {
  label: string;
  leaderLabel: string;
  role: RegExp;
  evidence: RegExp;
}

export const DOMAINS: Record<Domain, DomainDef> = {
  EXECUTIVE_SEARCH: {
    label: "executive search",
    leaderLabel: "Executive-search practice leadership",
    role: /\b(executive search|recruitment|recruiting|placement|headhunt|staffing|talent acquisition)\b/i,
    evidence: /\b(antal|korn ferry|egon zehnder|spencer stuart|heidrick|executive search|recruitment practice|placements?)\b/i,
  },
  DATA_AI_SERVICES: {
    label: "Data & AI services",
    leaderLabel: "Data & AI practice leadership",
    role: /\b(data (and|&) ai|ai service|generative ai|data engineering|machine learning|ai practice|service line)\b/i,
    evidence: /\b(ai practice|machine learning|data (and|&) ai|genai|generative ai)\b/i,
  },
  AGENCY_CLIENT_SERVICES: {
    label: "agency client services",
    leaderLabel: "Agency client leadership",
    role: /\b(client services|account director|agency|wpp|ogilvy|publicis|omnicom|dentsu|groupm|media agency)\b/i,
    evidence: /\b(vml|wpp|ogilvy|publicis|omnicom|dentsu|groupm|gtb|agency|fee book|retainer)\b/i,
  },
  DATA_PLATFORMS: {
    label: "data platforms",
    leaderLabel: "Data platform leadership",
    role: /\b(data platform|cdp|analytics platform)\b/i,
    evidence: /\b(cdp|customer data platform|ga4|analytics|salesforce (cdp|marketing cloud)|sfmc)\b/i,
  },
  AUTOMOTIVE: {
    label: "automotive",
    leaderLabel: "Automotive marketing leadership",
    role: /\b(automotive|2-wheeler|two-wheeler|oem|dealer)\b/i,
    evidence: /\b(tvs|ford|dealerships?|automotive|oem|vehicle)\b/i,
  },
  DIGITAL_MARKETING: {
    label: "digital marketing",
    leaderLabel: "Digital marketing leadership",
    role: /\b(digital marketing|performance marketing|paid media|seo|sem)\b/i,
    evidence: /\b(performance marketing|paid|adwords|seo|organic|leads|roas|digital)\b/i,
  },
  BRAND_MARKETING: {
    label: "brand marketing",
    leaderLabel: "Marketing leadership",
    role: /\b(brand|marketing|campaign|cmo)\b/i,
    evidence: /\b(brand|marketing|campaign|marketing mix)\b/i,
  },
  GCC_OPERATIONS: {
    label: "GCC operations",
    leaderLabel: "GCC leadership",
    role: /\b(gcc|global capability|shared services|offshore)\b/i,
    evidence: /\b(gcc|global capability|shared services)\b/i,
  },
  PRODUCT_GROWTH: {
    label: "product growth",
    leaderLabel: "Product growth leadership",
    role: /\b(product growth|growth head|product-led)\b/i,
    evidence: /\b(growth engineers|product managers|product-led)\b/i,
  },
  GENERAL: {
    label: "general management",
    leaderLabel: "General management",
    role: /$^/,
    evidence: /$^/,
  },
};

/** Domains close enough that evidence from one is ADJACENT to the other. */
const RELATED: Array<[Domain, Domain]> = [
  ["DATA_AI_SERVICES", "DATA_PLATFORMS"],
  ["AGENCY_CLIENT_SERVICES", "BRAND_MARKETING"],
  ["AGENCY_CLIENT_SERVICES", "DIGITAL_MARKETING"],
  ["DIGITAL_MARKETING", "BRAND_MARKETING"],
  ["DIGITAL_MARKETING", "DATA_PLATFORMS"],
  ["AUTOMOTIVE", "BRAND_MARKETING"],
  ["PRODUCT_GROWTH", "DIGITAL_MARKETING"],
];

export function domainsRelated(a: Domain, b: Domain): boolean {
  return RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Role-domain precedence: the most specific signal wins over generic marketing. */
const ROLE_PRECEDENCE: Domain[] = [
  "EXECUTIVE_SEARCH",
  "DATA_AI_SERVICES",
  "GCC_OPERATIONS",
  "AGENCY_CLIENT_SERVICES",
  "PRODUCT_GROWTH",
  "DATA_PLATFORMS",
  "AUTOMOTIVE",
  "DIGITAL_MARKETING",
  "BRAND_MARKETING",
];

export function detectRoleDomain(title: string, company: string, body: string): Domain {
  const head = `${title} ${company}`;
  for (const domain of ROLE_PRECEDENCE) if (DOMAINS[domain].role.test(head)) return domain;
  for (const domain of ROLE_PRECEDENCE) if (DOMAINS[domain].role.test(body)) return domain;
  return "GENERAL";
}

export function detectEvidenceDomains(text: string): Domain[] {
  return (Object.keys(DOMAINS) as Domain[]).filter((d) => DOMAINS[d].evidence.test(text));
}

/** Capability kinds evidenced by a claim, split into owned vs supporting. */
export const KIND_EVIDENCE: Array<{ kind: DimensionKind; owned: RegExp; support?: RegExp }> = [
  {
    kind: "COMMERCIAL_OWNERSHIP",
    owned: /\b(fee book|p&l|profit|retainer|attributed.*revenue|revenue from|revenue)\b/i,
    support: /\b(budget|marketing mix|pipeline)\b/i,
  },
  { kind: "CLIENT_LEADERSHIP", owned: /\b(fee book|retainer|client|account)\b/i },
  { kind: "NEW_BUSINESS", owned: /\b(net-new|pipeline|pitch|new business|retainer|won)\b/i },
  {
    kind: "PRACTICE_BUILDING",
    owned: /\b(center of excellence|centre of excellence|coe|built|set up|established|launched)\b/i,
    support: /\b(scaled|implemented)\b/i,
  },
  { kind: "TEAM_LEADERSHIP", owned: /\b(team of \d+|\d+-member|\d+-person|led .*team)\b/i },
  { kind: "MULTI_MARKET_SCOPE", owned: /\b(\d+ .*markets|apac|mena|middle east|regions|global)\b/i },
  { kind: "EXECUTIVE_STAKEHOLDER", owned: /\b(board of directors|board|c-level|cxo)\b/i },
  {
    kind: "DATA_TRANSFORMATION",
    owned: /\b(implemented .*(cdp|data)|data platform)\b/i,
    support: /\b(cdp|ga4|analytics|marketing cloud|sfmc)\b/i,
  },
];

export const KIND_LABELS: Record<DimensionKind, { noun: string; headline: string }> = {
  CORE_DOMAIN_DELIVERY: { noun: "domain delivery", headline: "Domain Leadership" },
  COMMERCIAL_OWNERSHIP: { noun: "commercial ownership", headline: "Commercial Ownership" },
  CLIENT_LEADERSHIP: { noun: "senior client leadership", headline: "Client Leadership" },
  NEW_BUSINESS: { noun: "new-business acquisition", headline: "New Business" },
  PRACTICE_BUILDING: { noun: "practice building", headline: "Capability Building" },
  TEAM_LEADERSHIP: { noun: "multidisciplinary team leadership", headline: "Team Leadership" },
  MULTI_MARKET_SCOPE: { noun: "multi-market scope", headline: "Multi-Market Scope" },
  EXECUTIVE_STAKEHOLDER: { noun: "board-level stakeholder work", headline: "Board Engagement" },
  DATA_TRANSFORMATION: { noun: "data and MarTech transformation", headline: "Data Transformation" },
};

/** Mandate language that signals each dimension. */
export const KIND_MANDATE: Array<{ kind: DimensionKind; pattern: RegExp }> = [
  { kind: "COMMERCIAL_OWNERSHIP", pattern: /\b(revenue|p&l|pricing|commercial|financial performance|fee|business acumen)\b/i },
  { kind: "CLIENT_LEADERSHIP", pattern: /\b(client|c-level|customer relationship)\b/i },
  { kind: "NEW_BUSINESS", pattern: /\b(business development|client acquisition|presales|proposal|pitch|proposition selling)\b/i },
  { kind: "PRACTICE_BUILDING", pattern: /\b(build|launch|define .*vision|practice|service line|establish|franchise|offerings?)\b/i },
  { kind: "TEAM_LEADERSHIP", pattern: /\b(team|mentor|hire)\b/i },
  { kind: "MULTI_MARKET_SCOPE", pattern: /\b(global|regional|markets|territory)\b/i },
  { kind: "EXECUTIVE_STAKEHOLDER", pattern: /\b(c-level|board|cxo)\b/i },
  { kind: "DATA_TRANSFORMATION", pattern: /\b(data engineering|analytics|data)\b/i },
];
