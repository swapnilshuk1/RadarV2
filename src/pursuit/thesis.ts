/**
 * src/pursuit/thesis.ts
 *
 * Derives the Pursuit Thesis — the single strategic anchor every downstream
 * artifact descends from.
 *
 * Two-stage by design:
 *   1. Deterministic derivation from the role brief, the Evidence Ledger and the
 *      chosen archetype. This always succeeds and is fully explainable.
 *   2. Model enrichment (Mantle, then Gemini) that sharpens language and names
 *      objections a rules engine cannot see.
 *
 * Stage 2 may only reference claim ids that stage 1 supplied. Anything citing an
 * unknown claim is discarded, which is the hallucination barrier in practice.
 */

import { generateWithFallback } from "./model";
import type { PursuitModelContext } from "./budget";
import { interpretPursuit } from "./semantic/interpret";
import { lowerFirst } from "./semantic/engine";
import { Phraser } from "./semantic/phrasing";
import { findLeakage, findSemanticInflation, hasOverclaim } from "./semantic/validate";
import type { EvidenceRelationship } from "./semantic/types";
import type { RoleBrief } from "./role-brief";
import type {
  ArchetypeScore,
  CandidateArchetype,
  CandidateClaim,
  Objection,
  OutreachRoute,
  ProofPoint,
  PursuitThesis,
  StyleProfile,
} from "./types";

export type DerivedThesis = Omit<PursuitThesis, "id" | "pursuitId" | "version" | "createdAt">;

/**
 * Stage 1: mandate decomposition → evidence mapping → composite positioning.
 * Archetypes are ingredients; the thesis is the positioning. Raw archetype
 * scores are retained internally for ranking, never shown.
 */
export function deriveDeterministicThesis(input: {
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  archetypes: readonly CandidateArchetype[];
  style: StyleProfile;
  preferredArchetypeId?: string | null;
  seed?: string;
}): DerivedThesis {
  const { brief, claims, archetypes, style } = input;
  const interpretation = interpretPursuit(input);
  const { snapshot, ranked, lenses, objectionDrafts, chosenArchetypeId } = interpretation;
  const byId = new Map(claims.map((c) => [c.id, c]));
  const dims = new Map(snapshot.mandate.dimensions.map((d) => [d.id, d]));
  const phraser = new Phraser(`${input.seed ?? brief.jobHash}|thesis`);
  const lateral = snapshot.positioning.mode === "LATERAL";

  const primaryProof: ProofPoint[] = ranked.map((r) => {
    const claim = byId.get(r.claimId)!;
    const dim = dims.get(r.primaryDimensionId);
    const relLabel =
      r.licensed === "DIRECT"
        ? "Direct evidence"
        : r.licensed === "ANALOGOUS"
          ? "Analogous evidence"
          : "Supporting evidence";
    return {
      claimId: claim.id,
      headline: claim.statement,
      whyItMatters: `${relLabel} for ${lowerFirst(dim?.label ?? "the mandate")}${claim.employer ? ` (${claim.employer})` : ""}.`,
      provenance: claim.provenance,
    };
  });

  const describe = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((c): c is CandidateClaim => Boolean(c))
      .map((c) => `${c.statement}${c.employer ? ` at ${c.employer}` : ""}`)
      .join("; ");

  const transferKinds = snapshot.coverage
    .filter((c) => c.dimensionId !== "dim-core" && (c.best === "DIRECT" || c.best === "ANALOGOUS"))
    .slice(0, 3)
    .map((c) => lowerFirst(c.label.replace(/ in .*$/, "")))
    .join(", ");

  const objections: Objection[] = objectionDrafts.map((draft, index) => {
    const evidence = describe(draft.supportingClaimIds);
    const vars = {
      domain: snapshot.mandate.roleDomainLabel,
      evidence: evidence || "your strongest attributable outcomes",
      kinds: transferKinds || "leadership",
    };
    let counter: string;
    if (!evidence) counter = phraser.pick("counterNoEvidence", `obj${index}`);
    else if (draft.kind === "DIMENSION" && draft.dimensionId === "dim-core")
      counter = phraser.pick("counterDirectGap", `obj${index}`, vars);
    else if (draft.kind === "DIMENSION") counter = phraser.pick("counterAnalogous", `obj${index}`, vars);
    else counter = phraser.pick("counterRequirement", `obj${index}`, vars);
    return {
      objection: draft.objection,
      counterPosition: counter,
      supportingClaimIds: draft.supportingClaimIds,
      severity: draft.severity,
    };
  });

  const archetypeScores: ArchetypeScore[] = lenses.map((l) => ({
    archetypeId: l.archetypeId,
    archetypeName: l.archetypeName,
    score: l.score,
    reasoning: l.reasons.join(" "),
    relationship: l.relationship,
    role: l.archetypeId === chosenArchetypeId ? "PRIMARY" : l.relationship === "LOW" ? "LOW" : "SUPPORTING",
  }));

  const positioning = snapshot.positioning;
  const winTheme = lateral
    ? `${positioning.label}. The case rests on transferable ${transferKinds || "executive scope"}; ${positioning.gaps[0] ?? "the domain shift should be named, not hidden."}`
    : `${positioning.label}, evidenced directly in ${describe(ranked.slice(0, 1).map((r) => r.claimId)) || "the record"}.`;

  return {
    archetypeId: chosenArchetypeId,
    targetMandate: snapshot.mandate.coreOutcome,
    winTheme,
    recommendedPositioning: [
      `Primary: ${positioning.label}.`,
      positioning.supporting.length ? `Supporting: ${positioning.supporting.join(", ")}.` : "",
      positioning.gaps.length ? `Named gap: ${positioning.gaps.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    primaryProof,
    objections,
    narrativesToAvoid: [
      lateral
        ? `Do not imply prior ${snapshot.mandate.roleDomainLabel} experience; call the transfer what it is.`
        : "Do not dilute the direct domain record with generic marketing breadth.",
      ...(archetypes.find((a) => a.id === chosenArchetypeId)?.deEmphasize ?? [])
        .slice(0, 2)
        .map((keyword) => `Keep ${keyword} in the background for this mandate.`),
      "Do not restate the job description back as if it were your experience.",
    ].slice(0, 5),
    targetAudience: [
      "Hiring executive / mandate owner",
      "Executive search consultant running the process",
      brief.company ? `${brief.company} talent leadership` : "Internal talent leadership",
    ],
    archetypeScores,
    archetypeMatchReasoning: lenses.find((l) => l.archetypeId === chosenArchetypeId)?.reasons.join(" ") ?? null,
    routeStrategy: deriveRoutes(brief),
    derivation: "DETERMINISTIC",
    modelId: null,
    semantic: snapshot,
  };
}
/** Channel strategy is a recommendation by seniority, not a discovered route. */
function deriveRoutes(brief: RoleBrief): OutreachRoute[] {
  return [
    {
      route: "Recommended: direct note to the mandate owner",
      stance: "PRIMARY",
      reasoning: "Senior mandates are decided by the hiring principal; a short, specific note lands better than an application record.",
    },
    {
      route: "Recommended: warm introduction where a credible contact exists",
      stance: "SECONDARY",
      reasoning: "Known contacts: none recorded yet. Add one to the pursuit when you identify it.",
    },
    {
      route: brief.applyUrl ? "Portal application as the only route" : "Untargeted recruiter broadcast",
      stance: "AVOID",
      reasoning: brief.applyUrl
        ? "File it for process compliance, but do not rely on it alone."
        : "Volume outreach spends credibility; this mandate rewards one specific argument.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Stage 2: model enrichment
// ---------------------------------------------------------------------------

interface ObjectionCandidate {
  id: string;
  objection: string;
  severity: Objection["severity"];
  supportingClaimIds: string[];
  source: "DETERMINISTIC" | "BRIEF_RISK";
}

const relationshipRank: Readonly<Record<EvidenceRelationship, number>> = {
  UNSUPPORTED: 0,
  ADJACENT: 1,
  ANALOGOUS: 2,
  DIRECT: 3,
};

function strongestRelationship(
  relationships: readonly EvidenceRelationship[],
): EvidenceRelationship {
  return relationships.reduce<EvidenceRelationship>(
    (best, current) => relationshipRank[current] > relationshipRank[best] ? current : best,
    "UNSUPPORTED",
  );
}

function objectionTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5 && !["there", "their", "would", "could", "should"].includes(token)),
  );
}

function objectionSimilarity(a: string, b: string): number {
  const left = objectionTokens(a);
  const right = objectionTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function buildObjectionCandidates(
  deterministic: DerivedThesis,
  brief: RoleBrief,
): ObjectionCandidate[] {
  const base: ObjectionCandidate[] = deterministic.objections.map((objection, index) => ({
    id: `base:${index}`,
    objection: objection.objection,
    severity: objection.severity,
    supportingClaimIds: objection.supportingClaimIds,
    source: "DETERMINISTIC",
  }));

  const riskInputs: Array<{ id: string; text: string | null | undefined; severity: Objection["severity"] }> = [
    { id: "risk:primary", text: brief.primaryRisk, severity: "MATERIAL" },
    { id: "risk:hiring", text: brief.hiringRisk, severity: "MODERATE" },
    ...brief.openQuestions.map((text, index) => ({
      id: `risk:open:${index}`,
      text,
      severity: "MODERATE" as const,
    })),
  ];

  const extras: ObjectionCandidate[] = [];
  for (const risk of riskInputs) {
    const text = risk.text?.trim();
    if (!text) continue;
    if ([...base, ...extras].some((candidate) => objectionSimilarity(candidate.objection, text) >= 0.55))
      continue;
    extras.push({
      id: risk.id,
      objection: text,
      severity: risk.severity,
      supportingClaimIds: [],
      source: "BRIEF_RISK",
    });
  }
  return [...base, ...extras];
}

function enrichmentSchema(objectionIds: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      targetMandate: { type: "string" },
      winTheme: { type: "string" },
      recommendedPositioning: { type: "string" },
      narrativesToAvoid: { type: "array", items: { type: "string" }, maxItems: 5 },
      proof: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            claimId: { type: "string" },
            headline: { type: "string" },
            whyItMatters: { type: "string" },
          },
          required: ["claimId", "headline", "whyItMatters"],
          additionalProperties: false,
        },
      },
      objections: {
        type: "array",
        maxItems: objectionIds.length > 0 ? 4 : 0,
        items: {
          type: "object",
          properties: {
            objectionId:
              objectionIds.length > 0
                ? { type: "string", enum: [...objectionIds] }
                : { type: "string" },
            objection: { type: "string" },
            counterPosition: { type: "string" },
            severity: { type: "string", enum: ["MATERIAL", "MODERATE", "MINOR"] },
            supportingClaimIds: { type: "array", items: { type: "string" } },
          },
          required: ["objectionId", "objection", "counterPosition", "severity", "supportingClaimIds"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "targetMandate",
      "winTheme",
      "recommendedPositioning",
      "narrativesToAvoid",
      "proof",
      "objections",
    ],
    additionalProperties: false,
  };
}

const ENRICHMENT_INSTRUCTION = `You are an executive search adviser sharpening a pursuit strategy for one candidate against one mandate.

Absolute rules:
1. You may only assert candidate facts that appear in the supplied ledger claims. Never invent an employer, title, date, metric or achievement.
2. Every proof entry must cite a claimId that exists in the supplied ledger. If you cannot cite one, omit the entry.
3. Copy metrics exactly as written in the claim. Never round, convert or extrapolate a number.
4. The win theme answers one question: why should this organisation talk to this candidate rather than another credible executive? Be specific and non-generic.
5. Do not use recruitment cliches ("results-driven", "proven track record", "passionate", "synergy", "dynamic professional").
6. The supplied objectionCandidates are the only objections you may return. Echo their objectionId exactly. You may reorder them and you may select a BRIEF_RISK candidate the deterministic draft missed, but do not invent a new objection outside that list. Each counter-position must be answerable from the ledger or must honestly name the gap.
7. Write as a senior adviser briefing a peer. Plain, specific, confident. No headings, no bullet markup inside strings.
8. Never write a claim identifier inside prose. Claim ids belong only in the claimId and supportingClaimIds fields. Naming the employer or the metric is how you attribute a fact in prose.
9. Each ledger claim carries relationshipToMandate (DIRECT, ANALOGOUS, ADJACENT). Never describe ANALOGOUS or ADJACENT evidence as having done this role before; call it comparable or related experience. Never write \"I have done this before\" unless the proof is DIRECT.
10. Use the supplied positioning (primary lens, supporting lenses, named gaps) as the thesis. Do not collapse it to a single generic label such as 'broad marketing leader'.
11. Never write internal instructions such as 'present through', 'lead with', 'this lens' or 'candidate should' in any string.`;

/**
 * Claim ids are provenance metadata, not prose. Models sometimes cite them
 * inline, which leaks internal identifiers into the executive's own reading.
 */
function stripClaimRefs(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/\(\s*(?:claim-[0-9a-f-]+)(?:\s*,\s*claim-[0-9a-f-]+)*\s*\)/gi, "")
    .replace(/\bclaim-[0-9a-f-]+\b/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


interface EnrichmentOutput {
  targetMandate: string;
  winTheme: string;
  recommendedPositioning: string;
  narrativesToAvoid: string[];
  proof: Array<{ claimId: string; headline: string; whyItMatters: string }>;
  objections: Array<{
    objectionId: string;
    objection: string;
    counterPosition: string;
    severity: string;
    supportingClaimIds: string[];
  }>;
}

/**
 * Stage 2. Returns the deterministic thesis untouched when no provider is
 * configured or every provider fails — the cockpit must always open.
 */
export async function enrichThesis(
  deterministic: DerivedThesis,
  input: {
    brief: RoleBrief;
    claims: readonly CandidateClaim[];
    archetype: CandidateArchetype | null;
    style: StyleProfile;
    /** Usage sink and token ceiling for this derivation. */
    model?: PursuitModelContext;
  },
): Promise<DerivedThesis> {
  const objectionCandidates = buildObjectionCandidates(deterministic, input.brief);
  const ledger = input.claims.slice(0, 80).map((claim) => ({
    claimId: claim.id,
    statement: claim.statement,
    employer: claim.employer,
    roleTitle: claim.roleTitle,
    metric: claim.metricResult,
    capabilities: claim.capabilities,
    relationshipToMandate: deterministic.semantic
      ? strongestRelationship(
          deterministic.semantic.mappings
            .filter((m) => m.claimId === claim.id)
            .map((m) => m.relationship),
        )
      : undefined,
  }));
  const allowed = new Set(ledger.map((claim) => claim.claimId));

  const result = await generateWithFallback<EnrichmentOutput>(
    "pursuit-thesis",
    ENRICHMENT_INSTRUCTION,
    {
      mandate: {
        company: input.brief.company,
        roleTitle: input.brief.roleTitle,
        location: input.brief.location,
        evaluationVerdict: input.brief.verdict,
        whyNow: input.brief.whyNow,
        hiringDriver: input.brief.primaryDriver,
        knownRisk: input.brief.primaryRisk,
        hiringRisk: input.brief.hiringRisk,
        priorities: input.brief.mandatePriorities,
        outcomes: input.brief.mandateOutcomes,
        requirements: input.brief.requirements,
      },
      positioningLens: input.archetype
        ? {
            name: input.archetype.name,
            positioningStatement: input.archetype.positioningStatement,
            emphasize: input.archetype.emphasize,
            deEmphasize: input.archetype.deEmphasize,
            tone: input.archetype.tone,
          }
        : null,
      ledgerClaims: ledger,
      // Presentation preference only. Explicitly not a source of fact.
      candidateStylePreferences: {
        preferredPhrasings: input.style.preferredPhrasings,
        avoidClaimIds: input.style.rejectedClaimIds,
      },
      positioning: deterministic.semantic?.positioning ?? null,
      mandateDimensions: deterministic.semantic?.coverage ?? null,
      objectionCandidates: objectionCandidates.map((candidate) => ({
        objectionId: candidate.id,
        objection: candidate.objection,
        severity: candidate.severity,
        source: candidate.source,
        supportingClaimIds: candidate.supportingClaimIds,
      })),
      deterministicDraft: {
        targetMandate: deterministic.targetMandate,
        winTheme: deterministic.winTheme,
        positioning: deterministic.recommendedPositioning,
      },
    },
    enrichmentSchema(objectionCandidates.map((candidate) => candidate.id)),
    (raw) => raw as EnrichmentOutput,
    input.model,
  );

  if (!result) return deterministic;
  const enriched = result.value;

  // Discard anything citing a claim outside the ledger.
  const proof: ProofPoint[] = (enriched.proof ?? [])
    .filter((entry) => allowed.has(entry.claimId))
    .map((entry) => {
      const claim = input.claims.find((c) => c.id === entry.claimId);
      return {
        claimId: entry.claimId,
        // The headline stays the verified statement; the model may only reframe
        // why it matters. This is where fabricated achievements would otherwise
        // enter the system.
        headline: claim?.statement ?? entry.headline,
        whyItMatters: entry.whyItMatters,
        provenance: claim?.provenance ?? "DERIVED",
      };
    });

  const candidateById = new Map(objectionCandidates.map((candidate) => [candidate.id, candidate]));
  const modelObjectionById = new Map(
    (enriched.objections ?? [])
      .filter((entry) => candidateById.has(entry.objectionId))
      .map((entry) => [entry.objectionId, entry]),
  );
  const safeCounter = (value: string | undefined): string | null => {
    const counter = stripClaimRefs(value);
    if (!counter || findLeakage(counter).length > 0) return null;
    if (hasOverclaim(counter, "ADJACENT")) return null;
    if (findSemanticInflation(counter, input.claims).length > 0) return null;
    return counter;
  };

  // Base objections retain deterministic identity/severity. Model output can
  // reorder them freely because the merge is keyed by objectionId, not index.
  const objections: Objection[] = deterministic.objections.map((base, index) => {
    const entry = modelObjectionById.get(`base:${index}`);
    const counter = safeCounter(entry?.counterPosition);
    return counter ? { ...base, counterPosition: counter } : base;
  });

  // A model may surface a role risk missed by deterministic coverage only when
  // that risk came from the trusted RoleBrief. The model supplies the counter,
  // never the objection identity or severity.
  for (const candidate of objectionCandidates.filter((item) => item.source === "BRIEF_RISK")) {
    const entry = modelObjectionById.get(candidate.id);
    if (!entry) continue;
    const counter = safeCounter(entry.counterPosition);
    if (!counter) continue;
    const supportingClaimIds = (entry.supportingClaimIds ?? []).filter((id) => allowed.has(id));
    const namesGapHonestly =
      /\b(?:gap|not evidenced|not visible|unproven|not in the record|needs? calibration|must be tested|should be tested)\b/i.test(counter);
    if (supportingClaimIds.length === 0 && !namesGapHonestly) continue;
    objections.push({
      objection: candidate.objection,
      counterPosition: counter,
      supportingClaimIds,
      severity: candidate.severity,
    });
  }
  const severityOrder = { MATERIAL: 0, MODERATE: 1, MINOR: 2 } as const;
  const finalObjections = objections
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .filter(
      (objection, index, all) =>
        all.findIndex((other) => objectionSimilarity(other.objection, objection.objection) >= 0.7) === index,
    )
    .slice(0, 4);

  const cleanRoleText = (value: string | undefined, fallback: string) => {
    const v = stripClaimRefs(value);
    return !v || findLeakage(v).length > 0 ? fallback : v;
  };
  const cleanCandidateText = (value: string | undefined, fallback: string) => {
    const v = stripClaimRefs(value);
    if (!v || findLeakage(v).length > 0) return fallback;
    const strongest = deterministic.semantic?.positioning.mode === "DIRECT_DOMAIN" ? "DIRECT" : "ANALOGOUS";
    if (hasOverclaim(v, strongest)) return fallback;
    return findSemanticInflation(v, input.claims).length > 0 ? fallback : v;
  };
  const rankedIds = new Set(deterministic.primaryProof.map((p) => p.claimId));
  const relationshipForClaim = (claimId: string): EvidenceRelationship =>
    deterministic.semantic
      ? strongestRelationship(
          deterministic.semantic.mappings
            .filter((mapping) => mapping.claimId === claimId)
            .map((mapping) => mapping.relationship),
        )
      : "UNSUPPORTED";
  const safeProof = proof.filter((p) => {
    if (!p.claimId || !rankedIds.has(p.claimId)) return false;
    if (findLeakage(p.whyItMatters).length > 0) return false;
    if (findSemanticInflation(p.whyItMatters, input.claims).length > 0) return false;
    return !hasOverclaim(p.whyItMatters, relationshipForClaim(p.claimId));
  });

  return {
    ...deterministic,
    targetMandate: cleanRoleText(enriched.targetMandate, deterministic.targetMandate),
    winTheme: cleanCandidateText(enriched.winTheme, deterministic.winTheme),
    // Positioning stays the deterministic composite: it is licensed by mappings.
    recommendedPositioning: deterministic.recommendedPositioning,
    narrativesToAvoid:
      enriched.narrativesToAvoid?.length > 0
        ? enriched.narrativesToAvoid.slice(0, 5).map(stripClaimRefs)
        : deterministic.narrativesToAvoid,
    // Proof selection is deterministic; the model may only reframe why it matters.
    primaryProof: deterministic.primaryProof.map(
      (p) => safeProof.find((s) => s.claimId === p.claimId && findLeakage(s.whyItMatters).length === 0) ?? p,
    ),
    objections: finalObjections,
    derivation: "MODEL",
    modelId: result.modelId,
  };
}
