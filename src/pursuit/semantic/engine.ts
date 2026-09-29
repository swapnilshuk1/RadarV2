/**
 * src/pursuit/semantic/engine.ts
 *
 * Deterministic pursuit interpretation:
 *   mandate decomposition → claim classification → evidence mapping (DIRECT
 *   guarded here) → coverage → composite positioning → proof ranking →
 *   materiality-aware objections.
 *
 * Pure and synchronous: no I/O and no model calls, so it is reproducible and
 * testable against frozen fixtures. Models may refine wording downstream, but
 * they cannot change what this layer licenses.
 */

import type { RoleBrief } from "../role-brief";
import type { CandidateArchetype, CandidateClaim, Objection, StyleProfile } from "../types";
import {
  DOMAINS,
  KIND_EVIDENCE,
  KIND_LABELS,
  KIND_MANDATE,
  detectEvidenceDomains,
  detectRoleDomain,
  domainsRelated,
} from "./taxonomy";
import {
  CRITICAL_CLASSES,
  SEMANTIC_VERSIONS,
  type ClaimClassification,
  type ClassifiedRequirement,
  type DimensionCoverage,
  type DimensionKind,
  type Domain,
  type EvidenceBundle,
  type EvidenceMapping,
  type EvidenceRelationship,
  type LensRelationshipRow,
  type MandateDimension,
  type MandateModel,
  type Positioning,
  type RequirementClass,
  type SemanticClaimType,
  type RenderState,
} from "./types";

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Requirement taxonomy
// ---------------------------------------------------------------------------

const REQUIREMENT_RULES: Array<[RequirementClass, RegExp]> = [
  ["HYGIENE_TOOL", /\b(google workspace|excel|powerpoint|ms office|microsoft office|word processing|jira|slack)\b/i],
  ["BOILERPLATE", /\b(equal opportunity|eeo|background check|right to work)\b/i],
  ["SOFT_SKILL", /\b(interpersonal|communication|presentation|public speaking|problem[- ]solving|prioriti[sz]ation|collaborat|team player|articulate)\b/i],
  ["GENERIC_TRAIT", /\b(inquisitiv|curious|entrepreneurial mindset|strategic thinking|self-starter|attitude|passion|drive)\b/i],
  ["CREDENTIAL_CRITICAL", /\b(\d+\s*(\+|to|-)?\s*\d*\s*years|degree|mba|certif|qualification)\b/i],
  ["COMMERCIAL_CRITICAL", /\b(revenue|p&l|business acumen|pricing|commercial)\b/i],
  ["DOMAIN_CRITICAL", /\b(category expertise|technical aptitude|industry knowledge|domain|data engineering|generative ai|executive search)\b/i],
  ["SCALE_CRITICAL", /\b(team of|large team|multi-country|global scale|headcount)\b/i],
];

export function classifyRequirement(text: string): RequirementClass {
  for (const [cls, pattern] of REQUIREMENT_RULES) if (pattern.test(text)) return cls;
  return "PREFERRED_CAPABILITY";
}

// ---------------------------------------------------------------------------
// A. Mandate decomposition
// ---------------------------------------------------------------------------

const SCOPED_KINDS: ReadonlySet<DimensionKind> = new Set([
  "CORE_DOMAIN_DELIVERY",
  "COMMERCIAL_OWNERSHIP",
  "CLIENT_LEADERSHIP",
  "NEW_BUSINESS",
  "PRACTICE_BUILDING",
]);

const KIND_CLASS: Record<DimensionKind, RequirementClass> = {
  CORE_DOMAIN_DELIVERY: "DOMAIN_CRITICAL",
  COMMERCIAL_OWNERSHIP: "COMMERCIAL_CRITICAL",
  CLIENT_LEADERSHIP: "MANDATE_CRITICAL",
  NEW_BUSINESS: "MANDATE_CRITICAL",
  PRACTICE_BUILDING: "MANDATE_CRITICAL",
  TEAM_LEADERSHIP: "SCALE_CRITICAL",
  MULTI_MARKET_SCOPE: "SCALE_CRITICAL",
  EXECUTIVE_STAKEHOLDER: "PREFERRED_CAPABILITY",
  DATA_TRANSFORMATION: "PREFERRED_CAPABILITY",
};

export function decomposeMandate(brief: RoleBrief): MandateModel {
  const priorities = [...brief.mandatePriorities, ...brief.mandateOutcomes];
  const reqTexts = brief.requirements.map((r) => r.requirement);
  const body = [brief.executiveThesis ?? "", ...priorities, ...reqTexts].join(" ");
  const roleDomain = detectRoleDomain(brief.roleTitle, brief.company, body);
  const def = DOMAINS[roleDomain];

  const dimensions: MandateDimension[] = [
    {
      id: "dim-core",
      kind: "CORE_DOMAIN_DELIVERY",
      scopedDomain: roleDomain === "GENERAL" ? null : roleDomain,
      label: def.leaderLabel,
      requirementClass: "DOMAIN_CRITICAL",
      importance: "REQUIRED",
      sourceText: brief.roleTitle,
    },
  ];

  for (const { kind, pattern } of KIND_MANDATE) {
    const fromPriority = priorities.find((p) => pattern.test(p));
    const fromReq = brief.requirements.find(
      (r) => pattern.test(r.requirement) && !["HYGIENE_TOOL", "SOFT_SKILL", "GENERIC_TRAIT", "BOILERPLATE"].includes(classifyRequirement(r.requirement)),
    );
    const source = fromPriority ?? fromReq?.requirement;
    if (!source) continue;
    const linked = fromReq ?? brief.requirements.find((r) => pattern.test(r.requirement));
    const scoped = SCOPED_KINDS.has(kind) && roleDomain !== "GENERAL" ? roleDomain : null;
    dimensions.push({
      id: `dim-${kind.toLowerCase()}`,
      kind,
      scopedDomain: scoped,
      label: scoped ? `${cap(KIND_LABELS[kind].noun)} in ${def.label}` : cap(KIND_LABELS[kind].noun),
      requirementClass: KIND_CLASS[kind],
      importance: fromPriority || fromReq?.mandatory ? "REQUIRED" : "PREFERRED",
      sourceText: source,
      dossierStatus: linked?.status ?? null,
      dossierCandidateClaimIds: linked?.candidateClaimIds ?? [],
      dossierEvidence: linked?.candidateEvidence ?? [],
    });
  }

  const requirements: ClassifiedRequirement[] = brief.requirements.map((r) => ({
    requirement: r.requirement,
    requirementClass: classifyRequirement(r.requirement),
    importance: r.mandatory ? "REQUIRED" : "PREFERRED",
    evaluatorStatus: r.status,
  }));

  return {
    roleDomain,
    roleDomainLabel: def.label,
    coreOutcome:
      brief.mandatePriorities[0] ?? brief.recommendation ?? `${brief.roleTitle} at ${brief.company}`,
    dimensions,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// B. Claim classification (source truth) and bundles
// ---------------------------------------------------------------------------

const OUTCOME_VERB = /^(scaled|grew|drove|increased|generated|delivered|reduced|improved|doubled|tripled|won)\b/i;
const ACTION_VERB = /^(led|managed|owned|built|launched|established|implemented|presented|ran|set up|created|designed|scaled|grew|drove|delivered|secured)\b/i;

function semanticType(claim: CandidateClaim): SemanticClaimType {
  const s = claim.statement.trim();
  switch (claim.claimType) {
    case "EMPLOYMENT":
      if (/\b(team of|\d+-member|\d+ (people|reports))\b/i.test(s)) return "SCOPE";
      return "ROLE_TITLE";
    case "EDUCATION":
      return "CREDENTIAL";
    case "LOCATION":
      return "SCOPE";
    case "TECHNOLOGY":
      return /^implemented|^built|^deployed/i.test(s) ? "PROJECT" : "CAPABILITY";
    case "LEADERSHIP":
      return /\d/.test(s) ? "SCOPE" : "RESPONSIBILITY";
    case "ACHIEVEMENT":
      if (OUTCOME_VERB.test(s)) return "OUTCOME";
      if (claim.metricResult && !ACTION_VERB.test(s)) return "METRIC";
      return "ACHIEVEMENT";
    default:
      return /\byears\b/i.test(s) ? "CREDENTIAL" : "RESPONSIBILITY";
  }
}

function renderState(type: SemanticClaimType, statement: string): RenderState {
  if (type === "ROLE_TITLE" || type === "CREDENTIAL") return "RAW_EVIDENCE";
  const words = statement.trim().split(/\s+/).length;
  if (ACTION_VERB.test(statement.trim()) && words >= 5) return "RESUME_READY";
  if (words < 7) return "NEEDS_CONTEXT";
  return "RAW_EVIDENCE";
}

export function classifyClaim(claim: CandidateClaim): ClaimClassification {
  const type = semanticType(claim);
  const text = `${claim.statement} ${claim.employer ?? ""} ${claim.roleTitle ?? ""}`;
  const kinds: DimensionKind[] = [];
  const supportOnly: DimensionKind[] = [];
  for (const rule of KIND_EVIDENCE) {
    if (rule.owned.test(claim.statement)) kinds.push(rule.kind);
    else if (rule.support?.test(claim.statement)) supportOnly.push(rule.kind);
  }
  return {
    claimId: claim.id,
    semanticType: type,
    renderState: renderState(type, claim.statement),
    domains: detectEvidenceDomains(text),
    kinds,
    supportOnlyKinds: supportOnly,
    version: SEMANTIC_VERSIONS.claimClassifier,
  };
}

export function buildBundles(claims: readonly CandidateClaim[]): EvidenceBundle[] {
  const map = new Map<string, EvidenceBundle>();
  for (const claim of claims) {
    if (!claim.employer) continue;
    const key = `${claim.employer}::${claim.roleTitle ?? ""}`;
    const bundle =
      map.get(key) ??
      ({
        id: `bundle-${fingerprint(key).slice(0, 10)}`,
        employer: claim.employer,
        roleTitle: claim.roleTitle,
        episode: null,
        claimIds: [],
      } satisfies EvidenceBundle);
    bundle.claimIds.push(claim.id);
    map.set(key, bundle);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// B. Evidence mapping — distance lives on the edge
// ---------------------------------------------------------------------------

/**
 * Verbs that assert the candidate personally carried the responsibility, as
 * opposed to participating in, supporting, or being exposed to it.
 */
const OWNERSHIP_VERBS =
  /\b(led|leads|leading|managed|manages|owned|owns|headed|heads|built|building|founded|launched|established|ran|running|directed|drove|delivered|scaled|restructured|turned around|set up|created|architected|governed|chaired|oversaw|oversees|accountable for|responsible for|p&l)\b/i;

/** Verbs that explicitly disclaim ownership; these veto DIRECT outright. */
const PARTICIPATION_VERBS =
  /\b(supported|supporting|assisted|contributed to|participated|involved in|exposed to|part of|collaborated|coordinated with|helped)\b/i;

/**
 * The deterministic licence for DIRECT.
 *
 * Source attribution alone is not ownership: "supported the GCC transition" is
 * just as source-backed as "led the GCC transition". DIRECT additionally
 * requires (a) an explicit ownership verb, (b) no disclaiming participation
 * verb, and (c) an attributable employer, so the strongest label in the pursuit
 * can always be defended from the candidate's own wording.
 */
const OWNED_CLAIM_TYPES = new Set(["ACHIEVEMENT", "LEADERSHIP", "EMPLOYMENT"]);

export function ownershipGuard(claim: CandidateClaim): boolean {
  if (claim.provenance !== "SOURCE_BACKED") return false;
  if (!claim.employer) return false;
  const text = claim.statement;
  // An explicit disclaimer of ownership vetoes DIRECT even when the fact is
  // perfectly source-backed: "supported the GCC transition" is not "led" it.
  if (PARTICIPATION_VERBS.test(text) && !OWNERSHIP_VERBS.test(text)) return false;
  if (OWNERSHIP_VERBS.test(text)) return true;
  // Extracted facts are frequently noun phrases ("$8M pure agency fee book").
  // Those carry ownership only when the ledger typed them as an achievement,
  // leadership or employment fact attributed to a role the candidate held.
  return OWNED_CLAIM_TYPES.has(claim.claimType) && Boolean(claim.roleTitle);
}

export function relate(
  dimension: MandateDimension,
  claim: CandidateClaim,
  c: ClaimClassification,
): { relationship: EvidenceRelationship; rationale: string } | null {
  const scoped = dimension.scopedDomain;
  const inDomain = scoped ? c.domains.includes(scoped) : true;
  const related = scoped ? c.domains.some((d) => domainsRelated(d, scoped)) : false;
  const direct = (why: string) =>
    ownershipGuard(claim)
      ? { relationship: "DIRECT" as const, rationale: why }
      : { relationship: "ANALOGOUS" as const, rationale: `${why} (evidence does not attribute ownership to the candidate)` };

  if (dimension.kind === "CORE_DOMAIN_DELIVERY") {
    if (!scoped) return null;
    if (inDomain) return direct(`Evidence sits inside ${DOMAINS[scoped].label}.`);
    if (related)
      return {
        relationship: "ADJACENT",
        rationale: `Related domain (${c.domains.map((d) => DOMAINS[d].label).join(", ")}), not ${DOMAINS[scoped].label} itself.`,
      };
    return null;
  }

  const owned = c.kinds.includes(dimension.kind);
  const support = c.supportOnlyKinds.includes(dimension.kind);
  if (!owned && !support) return null;
  if (!owned)
    return {
      relationship: "ADJACENT",
      rationale: `Supports ${KIND_LABELS[dimension.kind].noun} without establishing ownership.`,
    };
  if (inDomain) return direct(`Same responsibility in the same domain.`);
  return {
    relationship: "ANALOGOUS",
    rationale: `Same executive problem (${KIND_LABELS[dimension.kind].noun}) in a different domain.`,
  };
}

const REL_RANK: Record<EvidenceRelationship, number> = {
  DIRECT: 3,
  ANALOGOUS: 2,
  ADJACENT: 1,
  UNSUPPORTED: 0,
};

/**
 * The canonical evaluation is a ceiling, not a suggestion. Pursuit refines how
 * evidence is used; it may never call something DIRECT the evaluator judged
 * TRANSFERABLE, or promote evidence for a requirement the evaluator found absent.
 */
const DOSSIER_CEILING: Record<string, EvidenceRelationship> = {
  DIRECT: "DIRECT",
  TRANSFERABLE: "ANALOGOUS",
  ADJACENT: "ADJACENT",
  NOT_EVIDENCED: "UNSUPPORTED",
  CONTRADICTED: "UNSUPPORTED",
};

const tokens = (value: string) =>
  new Set(value.toLowerCase().match(/[a-z0-9$₹%]{3,}/g) ?? []);

/** True when a ledger claim restates evidence the dossier cited for this requirement. */
export function corroboratedByDossier(dimension: MandateDimension, claim: CandidateClaim): boolean {
  const cited = dimension.dossierEvidence ?? [];
  if (cited.length === 0) return false;
  const mine = tokens(claim.statement);
  if (mine.size === 0) return false;
  return cited.some((text) => {
    const theirs = tokens(text);
    let hit = 0;
    for (const t of mine) if (theirs.has(t)) hit += 1;
    return hit / mine.size >= 0.5;
  });
}

export function applyDossierCeiling(
  dimension: MandateDimension,
  relationship: EvidenceRelationship,
): EvidenceRelationship {
  const ceiling = dimension.dossierStatus ? DOSSIER_CEILING[dimension.dossierStatus] : undefined;
  if (!ceiling) return relationship;
  return REL_RANK[relationship] > REL_RANK[ceiling] ? ceiling : relationship;
}

export function mapEvidence(
  mandate: MandateModel,
  claims: readonly CandidateClaim[],
  classifications: ReadonlyMap<string, ClaimClassification>,
  bundles: readonly EvidenceBundle[],
): { mappings: EvidenceMapping[]; coverage: DimensionCoverage[] } {
  const bundleOf = new Map<string, string>();
  for (const b of bundles) for (const id of b.claimIds) bundleOf.set(id, b.id);
  const mappings: EvidenceMapping[] = [];
  const coverage: DimensionCoverage[] = [];

  for (const dimension of mandate.dimensions) {
    let best: EvidenceRelationship = "UNSUPPORTED";
    const ids: string[] = [];
    for (const claim of claims) {
      const c = classifications.get(claim.id);
      if (!c || c.semanticType === "CREDENTIAL") continue;
      const raw = relate(dimension, claim, c);
      if (!raw) continue;
      const capped = applyDossierCeiling(dimension, raw.relationship);
      if (capped === "UNSUPPORTED") continue;
      const corroborated = corroboratedByDossier(dimension, claim);
      const edge = {
        relationship: capped,
        rationale:
          capped !== raw.relationship
            ? `${raw.rationale} Capped at ${capped.toLowerCase()} by the evaluation (${dimension.dossierStatus?.toLowerCase().replace("_", " ")}).`
            : corroborated
              ? `${raw.rationale} Cited by the evaluation for this requirement.`
              : raw.rationale,
      };
      mappings.push({
        dimensionId: dimension.id,
        claimId: claim.id,
        bundleId: bundleOf.get(claim.id) ?? null,
        relationship: edge.relationship,
        rationale: edge.rationale,
        confidence: edge.relationship === "DIRECT" ? 0.9 : edge.relationship === "ANALOGOUS" ? 0.7 : 0.5,
      });
      ids.push(claim.id);
      if (REL_RANK[edge.relationship] > REL_RANK[best]) best = edge.relationship;
    }
    if (ids.length === 0)
      mappings.push({
        dimensionId: dimension.id,
        claimId: null,
        bundleId: null,
        relationship: "UNSUPPORTED",
        rationale: "No candidate evidence addresses this dimension.",
        confidence: 0.8,
      });
    coverage.push({ dimensionId: dimension.id, label: dimension.label, best, claimIds: ids });
  }
  return { mappings, coverage };
}

// ---------------------------------------------------------------------------
// Proof ranking: mandate relevance × directness, quantification a minor boost
// ---------------------------------------------------------------------------

const REL_WEIGHT: Record<EvidenceRelationship, number> = {
  DIRECT: 1,
  ANALOGOUS: 0.6,
  ADJACENT: 0.25,
  UNSUPPORTED: 0,
};

const CORE_CLASSES: ReadonlySet<RequirementClass> = new Set([
  "MANDATE_CRITICAL",
  "DOMAIN_CRITICAL",
  "COMMERCIAL_CRITICAL",
]);

/** Mandate-defining dimensions outrank generic scale signals. */
export function isMandateDefining(d: MandateDimension): boolean {
  return CORE_CLASSES.has(d.requirementClass);
}

function dimWeight(d: MandateDimension): number {
  const critical = CRITICAL_CLASSES.has(d.requirementClass);
  if (d.importance === "REQUIRED" && CORE_CLASSES.has(d.requirementClass)) return 3;
  if (d.importance === "REQUIRED" && critical) return 1.5;
  if (d.importance === "REQUIRED") return 2;
  return 1;
}

export interface RankedProof {
  claimId: string;
  score: number;
  primaryDimensionId: string;
  relationship: EvidenceRelationship;
  /** Phrase strength licensed for this proof in candidate-facing copy. */
  licensed: EvidenceRelationship;
}

export function rankProof(
  mandate: MandateModel,
  claims: readonly CandidateClaim[],
  classifications: ReadonlyMap<string, ClaimClassification>,
  mappings: readonly EvidenceMapping[],
  bundles: readonly EvidenceBundle[],
  style: StyleProfile,
  pinned: readonly string[] = [],
  limit = 3,
): RankedProof[] {
  const dims = new Map(mandate.dimensions.map((d) => [d.id, d]));
  const rejected = new Set(style.rejectedClaimIds);
  const promoted = new Set([...pinned, ...style.promotedClaimIds]);
  const bundleOf = new Map<string, string>();
  for (const b of bundles) for (const id of b.claimIds) bundleOf.set(id, b.id);

  const candidates = claims
    .filter((claim) => !rejected.has(claim.id))
    .map((claim) => {
      const c = classifications.get(claim.id);
      if (!c || ["ROLE_TITLE", "CREDENTIAL", "CAPABILITY"].includes(c.semanticType)) return null;
      if (claim.claimType === "LOCATION") return null; // a place is context, not proof
      const edges = mappings.filter((m) => m.claimId === claim.id);
      if (edges.length === 0) return null;
      let score = 0;
      let primary = edges[0]!;
      let primaryValue = -1;
      for (const edge of edges) {
        const d = dims.get(edge.dimensionId);
        if (!d) continue;
        const value = dimWeight(d) * REL_WEIGHT[edge.relationship];
        score += value;
        if (value > primaryValue) {
          primaryValue = value;
          primary = edge;
        }
      }
      if (claim.metricResult) score += 0.3;
      // A projection is weaker proof than a realised result.
      if (/\b(projected|forecast|target(ed)?|expected)\b/i.test(claim.statement)) score *= 0.7;
      if (promoted.has(claim.id)) score += 2;
      return { claim, score, primary };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.score > 0));

  const chosen: RankedProof[] = [];
  const usedDims = new Set<string>();
  const usedBundles = new Map<string, number>();
  const pool = [...candidates];
  while (chosen.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    pool.forEach((item, idx) => {
      let s = item.score;
      if (usedDims.has(item.primary.dimensionId)) s *= 0.35;
      const b = bundleOf.get(item.claim.id);
      if (b && (usedBundles.get(b) ?? 0) > 0) s *= 0.7;
      if (s > bestScore) {
        bestScore = s;
        bestIdx = idx;
      }
    });
    const [item] = pool.splice(bestIdx, 1);
    if (!item) break;
    usedDims.add(item.primary.dimensionId);
    const b = bundleOf.get(item.claim.id);
    if (b) usedBundles.set(b, (usedBundles.get(b) ?? 0) + 1);
    chosen.push({
      claimId: item.claim.id,
      score: Math.round(item.score * 100) / 100,
      primaryDimensionId: item.primary.dimensionId,
      relationship: bestRelationship(mappings, item.claim.id),
      licensed: licensedStrength(mandate, mappings, item.claim.id),
    });
  }
  return chosen;
}

/**
 * DIRECT phrasing ("a direct precedent") is licensed only when the claim is
 * DIRECT on a mandate-defining dimension. DIRECT on generic scale (team size,
 * markets) is honest supporting evidence, not proof of doing the mandate.
 */
export function licensedStrength(
  mandate: MandateModel,
  mappings: readonly EvidenceMapping[],
  claimId: string,
): EvidenceRelationship {
  const dims = new Map(mandate.dimensions.map((d) => [d.id, d]));
  let best: EvidenceRelationship = "UNSUPPORTED";
  for (const m of mappings) {
    if (m.claimId !== claimId) continue;
    const d = dims.get(m.dimensionId);
    let r = m.relationship;
    if (d && !isMandateDefining(d) && r === "DIRECT") r = "ADJACENT";
    if (d && !isMandateDefining(d) && r === "ANALOGOUS") r = "ADJACENT";
    if (REL_RANK[r] > REL_RANK[best]) best = r;
  }
  return best;
}

export function bestRelationship(
  mappings: readonly EvidenceMapping[],
  claimId: string,
): EvidenceRelationship {
  let best: EvidenceRelationship = "UNSUPPORTED";
  for (const m of mappings)
    if (m.claimId === claimId && REL_RANK[m.relationship] > REL_RANK[best]) best = m.relationship;
  return best;
}

// ---------------------------------------------------------------------------
// C. Composite positioning and lens relationships
// ---------------------------------------------------------------------------

export function composePositioning(
  mandate: MandateModel,
  coverage: readonly DimensionCoverage[],
): Positioning {
  const dims = new Map(mandate.dimensions.map((d) => [d.id, d]));
  const core = coverage.find((c) => c.dimensionId === "dim-core");
  const mode = core?.best === "DIRECT" ? "DIRECT_DOMAIN" : "LATERAL";
  const strong = coverage
    .filter((c) => c.dimensionId !== "dim-core" && (c.best === "DIRECT" || c.best === "ANALOGOUS"))
    .map((c) => ({ c, d: dims.get(c.dimensionId)! }))
    .sort(
      (a, b) =>
        Number(isMandateDefining(b.d)) - Number(isMandateDefining(a.d)) ||
        dimWeight(b.d) - dimWeight(a.d) ||
        REL_RANK[b.c.best] - REL_RANK[a.c.best] ||
        b.c.claimIds.length - a.c.claimIds.length,
    );
  const nouns = strong.slice(0, 2).map(({ d }) => KIND_LABELS[d.kind].noun);
  const def = DOMAINS[mandate.roleDomain];
  const joined = nouns.length === 2 ? `${nouns[0]} and ${nouns[1]}` : (nouns[0] ?? "senior leadership scope");

  const label =
    mode === "DIRECT_DOMAIN"
      ? `${def.leaderLabel} with ${joined}`
      : `Transferable ${joined}, applied to ${def.label}`;

  const gaps = coverage
    .filter((c) => {
      const d = dims.get(c.dimensionId);
      return (
        d &&
        d.importance === "REQUIRED" &&
        CRITICAL_CLASSES.has(d.requirementClass) &&
        (c.best === "UNSUPPORTED" || c.best === "ADJACENT")
      );
    })
    .map((c) => `Direct ${lowerFirst(c.label)} is not established in the record.`);

  return {
    id: `${mode}:${mandate.roleDomain}`,
    mode,
    domain: mandate.roleDomain,
    label,
    supporting: strong.slice(2, 5).map(({ d }) => cap(KIND_LABELS[d.kind].noun)),
    gaps,
  };
}

export function lensRelationships(
  mandate: MandateModel,
  archetypes: readonly CandidateArchetype[],
  claims: readonly CandidateClaim[],
  classifications: ReadonlyMap<string, ClaimClassification>,
  mappings: readonly EvidenceMapping[],
  coreDirect: boolean,
  style: StyleProfile,
): LensRelationshipRow[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  return archetypes
    .map((archetype) => {
      const lensText = `${archetype.name} ${archetype.emphasize.join(" ")}`;
      const lensDomains = detectEvidenceDomains(lensText);
      const keywords = archetype.emphasize.map((k) => k.toLowerCase());
      let score = 0;
      const reasons: string[] = [];
      for (const m of mappings) {
        if (!m.claimId) continue;
        const claim = byId.get(m.claimId);
        const c = classifications.get(m.claimId);
        if (!claim || !c) continue;
        const aligned =
          c.domains.some((d) => lensDomains.includes(d)) ||
          keywords.some((k) => claim.statement.toLowerCase().includes(k));
        if (aligned) score += REL_RANK[m.relationship];
      }
      const inDomain = lensDomains.includes(mandate.roleDomain);
      const related = lensDomains.some((d) => domainsRelated(d, mandate.roleDomain));
      if (inDomain) {
        score += 10;
        reasons.push(`Same domain as the mandate (${mandate.roleDomainLabel}).`);
      } else if (related) {
        score += 3;
        reasons.push(`Related to ${mandate.roleDomainLabel}, not the same domain.`);
      } else {
        reasons.push(`Different domain from ${mandate.roleDomainLabel}; useful only as transferable evidence.`);
      }
      const overrides = style.archetypeOverrides.filter((o) => o.to === archetype.id).length;
      score += overrides * 3;
      if (overrides > 0) reasons.push(`You have chosen this lens ${overrides}x before.`);
      const relationship: LensRelationshipRow["relationship"] =
        inDomain && coreDirect ? "STRONG_DIRECT" : score >= 8 ? "SUPPORTING" : "LOW";
      return { archetypeId: archetype.id, archetypeName: archetype.name, score, relationship, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Objections with tight materiality
// ---------------------------------------------------------------------------

export interface ObjectionDraft extends Objection {
  dimensionId: string | null;
  kind: "DIMENSION" | "REQUIREMENT";
}

const NEVER_OBJECTION: ReadonlySet<RequirementClass> = new Set([
  "GENERIC_TRAIT",
  "SOFT_SKILL",
  "HYGIENE_TOOL",
  "BOILERPLATE",
]);

export function deriveObjectionDrafts(
  mandate: MandateModel,
  coverage: readonly DimensionCoverage[],
  mappings: readonly EvidenceMapping[],
  claims: readonly CandidateClaim[],
  classifications: ReadonlyMap<string, ClaimClassification>,
): ObjectionDraft[] {
  const dims = new Map(mandate.dimensions.map((d) => [d.id, d]));
  const out: ObjectionDraft[] = [];

  for (const c of coverage) {
    const d = dims.get(c.dimensionId);
    if (!d || c.best === "DIRECT") continue;
    const critical = CRITICAL_CLASSES.has(d.requirementClass) && d.importance === "REQUIRED";
    const severity: Objection["severity"] =
      c.best === "ANALOGOUS"
        ? "MODERATE"
        : critical
          ? "MATERIAL"
          : c.best === "ADJACENT"
            ? "MINOR"
            : "MODERATE";
    if (!critical && c.best === "ANALOGOUS") continue; // adequate transferable evidence
    const analogues = mappings
      .filter((m) => m.dimensionId === d.id && m.claimId && m.relationship !== "UNSUPPORTED")
      .map((m) => m.claimId!)
      .slice(0, 2);
    // Where the dimension itself has nothing, draw on the strongest analogues
    // elsewhere in the mandate so the counter-position is still specific.
    const transferable =
      analogues.length > 0
        ? analogues
        : mappings
            .filter(
              (m) =>
                m.claimId &&
                (m.relationship === "DIRECT" || m.relationship === "ANALOGOUS") &&
                classifications.get(m.claimId)?.semanticType !== "ROLE_TITLE",
            )
            .map((m) => m.claimId!)
            .filter((id, i, arr) => arr.indexOf(id) === i)
            .slice(0, 3);
    out.push({
      objection:
        c.best === "ANALOGOUS"
          ? `Your ${KIND_LABELS[d.kind].noun} comes from a different domain than ${mandate.roleDomainLabel}.`
          : `There is no visible evidence of ${lowerFirst(d.label)}.`,
      counterPosition: "",
      supportingClaimIds: transferable,
      severity,
      dimensionId: d.id,
      kind: "DIMENSION",
    });
  }

  for (const r of mandate.requirements) {
    if (NEVER_OBJECTION.has(r.requirementClass)) continue;
    if (!["NOT_EVIDENCED", "CONTRADICTED", "TRANSFERABLE", "ADJACENT"].includes(r.evaluatorStatus)) continue;
    const critical = CRITICAL_CLASSES.has(r.requirementClass) && r.importance === "REQUIRED";
    const insufficient = r.evaluatorStatus === "NOT_EVIDENCED" || r.evaluatorStatus === "CONTRADICTED";
    const severity: Objection["severity"] = critical && insufficient ? "MATERIAL" : critical ? "MODERATE" : "MINOR";
    const tokens = r.requirement
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((w) => w.length > 4);
    const support = claims
      .filter((claim) => {
        const text = `${claim.statement} ${claim.employer ?? ""}`.toLowerCase();
        const domains = classifications.get(claim.id)?.domains ?? [];
        return tokens.some((t) => text.includes(t)) || (r.requirementClass === "DOMAIN_CRITICAL" && domains.length > 0 && tokens.some((t) => /wheeler|automotive|vehicle/.test(t)) && domains.includes("AUTOMOTIVE"));
      })
      .map((claim) => claim.id)
      .slice(0, 2);
    out.push({
      objection:
        r.evaluatorStatus === "CONTRADICTED"
          ? `Your record appears to run against "${r.requirement}".`
          : `They will test "${r.requirement}".`,
      counterPosition: "",
      supportingClaimIds: support,
      severity,
      dimensionId: null,
      kind: "REQUIREMENT",
    });
  }

  const order = { MATERIAL: 0, MODERATE: 1, MINOR: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 4);
}

// ---------------------------------------------------------------------------

export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const lowerFirst = (s: string) =>
  s && /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;

export type { Domain };
