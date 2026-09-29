/**
 * src/pursuit/artifacts.ts
 *
 * Generates every pursuit artifact from one thesis.
 *
 * The contract that makes this safe: generation chooses *which* verified claims
 * appear and *how* they are framed. It never authors a new fact. Resume bullets
 * are assembled from ledger statements, and any reframing that touches a locked
 * metric is rejected in favour of the verified wording.
 */

import { generateWithFallback } from "./model";
import { ledgerApprovalBlockers } from "./approval";
import type { PursuitModelContext } from "./budget";
import { classifyClaim, bestRelationship, cap } from "./semantic/engine";
import { KIND_LABELS } from "./semantic/taxonomy";
import { Phraser, type CareerMove } from "./semantic/phrasing";
import { findLeakage, gradeStory, validateMessage, validateResume } from "./semantic/validate";
import type { ClaimClassification, EvidenceRelationship, SemanticSnapshot } from "./semantic/types";
import type { RoleBrief } from "./role-brief";
import type {
  ArtifactContent,
  ArtifactType,
  CandidateArchetype,
  CandidateClaim,
  InterviewBriefContent,
  MessageContent,
  ProofStory,
  PursuitThesis,
  ResumeBullet,
  ResumeContent,
  ResumeRole,
  StyleProfile,
} from "./types";

export interface CandidateIdentity {
  fullName: string;
  contactLine: string;
}

const toBullet = (claim: CandidateClaim): ResumeBullet => ({
  claimId: claim.id,
  text: claim.statement,
  edited: false,
  provenance: claim.provenance,
});

// ---------------------------------------------------------------------------
// Semantic context shared by every artifact
// ---------------------------------------------------------------------------

interface SemanticContext {
  snapshot: SemanticSnapshot | null;
  classes: Map<string, ClaimClassification>;
  relevance: Map<string, number>;
  move: CareerMove;
  phraser: Phraser;
}

const REL_SCORE: Record<EvidenceRelationship, number> = { DIRECT: 3, ANALOGOUS: 2, ADJACENT: 1, UNSUPPORTED: 0 };

const CONTEXTS = new WeakMap<PursuitThesis, Map<string, SemanticContext>>();

/** One context (and one phraser) per thesis package, so no phrase repeats across its artifacts. */
function semanticContext(thesis: PursuitThesis, claims: readonly CandidateClaim[], slot: string): SemanticContext {
  const perThesis = CONTEXTS.get(thesis) ?? new Map<string, SemanticContext>();
  CONTEXTS.set(thesis, perThesis);
  const key = slot === "outreach" || slot === "resume" ? "package" : slot;
  const existing = perThesis.get(key);
  if (existing) return existing;
  const created = buildContext(thesis, claims, key);
  perThesis.set(key, created);
  return created;
}

function buildContext(thesis: PursuitThesis, claims: readonly CandidateClaim[], slot: string): SemanticContext {
  const snapshot = thesis.semantic ?? null;
  const classes = new Map<string, ClaimClassification>();
  for (const c of snapshot?.classifications ?? []) classes.set(c.claimId, c);
  for (const claim of claims) if (!classes.has(claim.id)) classes.set(claim.id, classifyClaim(claim));
  const relevance = new Map<string, number>();
  for (const m of snapshot?.mappings ?? [])
    if (m.claimId) relevance.set(m.claimId, (relevance.get(m.claimId) ?? 0) + REL_SCORE[m.relationship]);
  return {
    snapshot,
    classes,
    relevance,
    move: snapshot?.positioning.mode === "LATERAL" ? "LATERAL" : "SAME_DOMAIN",
    phraser: new Phraser(`${thesis.pursuitId}|${thesis.version}|${slot}`),
  };
}

function relationshipOf(ctx: SemanticContext, claimId: string | null): EvidenceRelationship {
  if (!claimId || !ctx.snapshot) return "ADJACENT";
  return ctx.snapshot.proofRelationships[claimId] ?? bestRelationship(ctx.snapshot.mappings, claimId);
}

/** Strongest relationship licensed across the proofs a message may cite. */
function strongestProof(ctx: SemanticContext, thesis: PursuitThesis): EvidenceRelationship {
  let best: EvidenceRelationship = "UNSUPPORTED";
  for (const p of thesis.primaryProof) {
    const r = relationshipOf(ctx, p.claimId);
    if (REL_SCORE[r] > REL_SCORE[best]) best = r;
  }
  return best;
}

/**
 * Compose a selected-impact line from one bundle: the anchor fact plus at most
 * one related fact from the same role. Every clause is a verified statement;
 * the only generated words are the dimension label.
 */
function composeImpact(
  anchor: CandidateClaim,
  claims: readonly CandidateClaim[],
  ctx: SemanticContext,
  usedIds: Set<string>,
): ResumeBullet {
  const c = ctx.classes.get(anchor.id);
  usedIds.add(anchor.id);
  if (c?.renderState === "RESUME_READY") return toBullet(anchor);
  const bundle = ctx.snapshot?.bundles.find((b) => b.claimIds.includes(anchor.id));
  const kind = c?.kinds[0];
  const anchorKinds = new Set(c?.kinds ?? []);
  const lead = kind ? `${cap(KIND_LABELS[kind].noun)}: ` : "";
  const companion = bundle
    ? claims.find(
        (claim) =>
          bundle.claimIds.includes(claim.id) &&
          claim.id !== anchor.id &&
          !usedIds.has(claim.id) &&
          ["METRIC", "SCOPE", "ACHIEVEMENT", "OUTCOME"].includes(ctx.classes.get(claim.id)?.semanticType ?? "") &&
          // Only combine facts that describe the same executive story.
          (ctx.classes.get(claim.id)?.kinds ?? []).some((k) => anchorKinds.has(k)) &&
          (ctx.relevance.get(claim.id) ?? 0) > 0,
      )
    : undefined;
  if (companion) usedIds.add(companion.id);
  const where = anchor.employer ? ` (${anchor.employer})` : "";
  const text = `${lead}${anchor.statement}${companion ? `, alongside ${lowerStart(companion.statement)}` : ""}${where}`;
  return { claimId: anchor.id, text, edited: false, provenance: anchor.provenance };
}

const lowerStart = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Candidate identity headline from covered dimensions — never the target title. */
function identityHeadline(ctx: SemanticContext, fallbackCaps: string[]): string {
  const labels: string[] = [];
  const dims = new Map((ctx.snapshot?.mandate.dimensions ?? []).map((d) => [d.id, d]));
  for (const c of ctx.snapshot?.coverage ?? []) {
    const d = dims.get(c.dimensionId);
    if (!d || d.kind === "CORE_DOMAIN_DELIVERY") continue;
    if (c.best === "DIRECT" || c.best === "ANALOGOUS") labels.push(KIND_LABELS[d.kind].headline);
  }
  const core = ctx.snapshot?.coverage.find((c) => c.dimensionId === "dim-core");
  if (core?.best === "DIRECT" && ctx.snapshot) labels.unshift(ctx.snapshot.positioning.label.split(" with ")[0]!);
  const unique: string[] = [];
  const words = new Set<string>();
  for (const label of [...labels, ...fallbackCaps]) {
    const sig = label.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (sig.some((w) => words.has(w))) continue;
    sig.forEach((w) => words.add(w));
    unique.push(label.replace(/\b\w/g, (m) => m.toUpperCase()));
    if (unique.length === 3) break;
  }
  return unique.length ? unique.join(" | ") : "Senior Leadership";
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/**
 * Groups ledger claims into roles. Claims with no employer attribution are not
 * discarded — they become capability evidence rather than being silently lost.
 */
function buildRoles(
  claims: readonly CandidateClaim[],
  archetype: CandidateArchetype | null,
  usedClaimIds: ReadonlySet<string>,
  style: StyleProfile,
  ctx?: SemanticContext,
): ResumeRole[] {
  const rejected = new Set(style.rejectedClaimIds);
  const emphasis = (archetype?.emphasize ?? []).map((keyword) => keyword.toLowerCase());
  const byEmployer = new Map<string, CandidateClaim[]>();

  for (const claim of claims) {
    if (!claim.employer || rejected.has(claim.id) || usedClaimIds.has(claim.id)) continue;
    if (claim.claimType === "EDUCATION" || claim.claimType === "LOCATION") continue;
    const type = ctx?.classes.get(claim.id)?.semanticType;
    if (type === "ROLE_TITLE" || type === "CREDENTIAL") continue;
    const list = byEmployer.get(claim.employer) ?? [];
    list.push(claim);
    byEmployer.set(claim.employer, list);
  }

  return [...byEmployer.entries()].map(([employer, employerClaims]) => {
    // Order bullets by relevance to the archetype, not by extraction order.
    const ordered = [...employerClaims].sort((a, b) => {
      const score = (claim: CandidateClaim) => {
        let value = (ctx?.relevance.get(claim.id) ?? 0) * 6 + (claim.metricResult ? 1 : 0);
        if (emphasis.some((keyword) => claim.statement.toLowerCase().includes(keyword))) value += 8;
        if (style.promotedClaimIds.includes(claim.id)) value += 10;
        return value;
      };
      return score(b) - score(a);
    });
    return {
      employer,
      roleTitle: ordered.find((claim) => claim.roleTitle)?.roleTitle ?? "",
      period: null,
      // Promote relevant bullets, hide the irrelevant tail (keep at least one).
      bullets: ordered
        .filter((claim, i) => i === 0 || !ctx || (ctx.relevance.get(claim.id) ?? 0) > 0 || ordered.length <= 3)
        .slice(0, 6)
        .map(toBullet),
    };
  });
}

/**
 * Anchor-CV transformation. The candidate's chosen source CV is the skeleton:
 * its roles in its own order, its bullets in its own order. Tailoring is limited
 * to safe operations — promote relevant bullets within a role, hide the
 * irrelevant tail, and insert explicitly pinned evidence. Nothing is rewritten
 * and no role is created that the anchor CV (or a pin) does not supply.
 */
function transformAnchor(
  anchorIds: readonly string[],
  claims: readonly CandidateClaim[],
  archetype: CandidateArchetype | null,
  usedClaimIds: ReadonlySet<string>,
  style: StyleProfile,
  ctx?: SemanticContext,
): ResumeRole[] | null {
  const anchors = new Set(anchorIds);
  const skeleton = claims.filter((c) => c.sourceDocumentId && anchors.has(c.sourceDocumentId));
  if (skeleton.length === 0) return null;
  const rejected = new Set(style.rejectedClaimIds);
  const pinned = new Set(archetype?.pinnedClaimIds ?? []);
  const emphasis = (archetype?.emphasize ?? []).map((k) => k.toLowerCase());
  const eligible = (claim: CandidateClaim) => {
    if (!claim.employer || rejected.has(claim.id) || usedClaimIds.has(claim.id)) return false;
    if (claim.claimType === "EDUCATION" || claim.claimType === "LOCATION") return false;
    const type = ctx?.classes.get(claim.id)?.semanticType;
    return type !== "ROLE_TITLE" && type !== "CREDENTIAL";
  };
  const ord = (c: CandidateClaim) => c.sourceOrdinal ?? Number.MAX_SAFE_INTEGER;

  const roles = new Map<string, { order: number; title: string; claims: CandidateClaim[] }>();
  for (const claim of [...skeleton].sort((x, y) => ord(x) - ord(y))) {
    if (!claim.employer) continue;
    const entry = roles.get(claim.employer) ?? { order: ord(claim), title: "", claims: [] };
    if (!entry.title && claim.roleTitle) entry.title = claim.roleTitle;
    if (eligible(claim)) entry.claims.push(claim);
    roles.set(claim.employer, entry);
  }
  // Pinned evidence from other source documents joins its employer, or appends.
  for (const claim of claims) {
    if (!pinned.has(claim.id) || !eligible(claim) || skeleton.includes(claim)) continue;
    const key = claim.employer!;
    const entry = roles.get(key) ?? { order: Number.MAX_SAFE_INTEGER, title: claim.roleTitle ?? "", claims: [] };
    entry.claims.push(claim);
    roles.set(key, entry);
  }

  const relevanceOf = (claim: CandidateClaim) => {
    let value = (ctx?.relevance.get(claim.id) ?? 0) * 6;
    if (emphasis.some((k) => claim.statement.toLowerCase().includes(k))) value += 8;
    if (style.promotedClaimIds.includes(claim.id)) value += 10;
    if (pinned.has(claim.id)) value += 20;
    return value;
  };

  return [...roles.entries()]
    .sort((x, y) => x[1].order - y[1].order)
    .filter(([, entry]) => entry.claims.length > 0)
    .map(([employer, entry]) => {
      // Stable promotion: relevant bullets rise, original order breaks ties.
      const ordered = [...entry.claims].sort((x, y) => relevanceOf(y) - relevanceOf(x) || ord(x) - ord(y));
      const kept = ordered.filter(
        (claim, i) => i < 3 || pinned.has(claim.id) || relevanceOf(claim) > 0,
      );
      return {
        employer,
        roleTitle: entry.title,
        period: null,
        bullets: kept.slice(0, Math.max(6, kept.filter((c) => pinned.has(c.id)).length)).map(toBullet),
      };
    });
}

const RESUME_NARRATIVE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    headline: { type: "string" },
    executiveSummary: { type: "string" },
  },
  required: ["headline", "executiveSummary"],
  additionalProperties: false,
};

const RESUME_NARRATIVE_INSTRUCTION = `Write the headline and executive summary for one tailored executive resume.

Absolute rules:
1. Use only the supplied verified claims and mandate context. Never invent an employer, title, date, metric, certification or achievement.
2. Copy any number exactly as it appears in a claim. If a number is not in the claims, do not write a number.
3. The headline states the candidate's professional identity (e.g. "Client Leadership | Commercial Growth | Integrated Marketing"). Never use the target job title as the headline.
4. The executive summary is 3 to 4 sentences, first-person-implied (no "I"), arguing why this candidate fits THIS mandate. It must reflect the supplied win theme.
5. Ban these words and their variants: results-driven, proven track record, passionate, dynamic, synergy, go-getter, thought leader, seasoned professional, hard-working.
6. Plain prose only. No bullet markers, no headings, no markdown.
7. The supplied positioning is private strategy. Never write instructions such as "present through", "lead with", "this lens", "most relevant precedent" or "candidate should".
8. Where evidence is marked ANALOGOUS, describe it as transferable experience, not as direct experience in the target domain.`;

export async function generateResume(input: {
  identity: CandidateIdentity;
  thesis: PursuitThesis;
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  archetype: CandidateArchetype | null;
  style: StyleProfile;
  /** Usage sink and token ceiling for this derivation. */
  model?: PursuitModelContext;
}): Promise<ResumeContent> {
  const { identity, thesis, brief, claims, archetype, style } = input;
  const byId = new Map(claims.map((claim) => [claim.id, claim]));

  const ctx = semanticContext(thesis, claims, "resume");
  const usedIds = new Set<string>();
  const impactAnchors: ResumeBullet[] = thesis.primaryProof
    .map((proof) => (proof.claimId ? byId.get(proof.claimId) : undefined))
    .filter((claim): claim is CandidateClaim => Boolean(claim))
    .filter((claim) => ctx.classes.get(claim.id)?.semanticType !== "ROLE_TITLE")
    .map((claim) => composeImpact(claim, claims, ctx, usedIds));

  const anchorIds = archetype?.anchorDocumentIds ?? [];
  const anchored = anchorIds.length ? transformAnchor(anchorIds, claims, archetype, usedIds, style, ctx) : null;
  const roles = anchored ?? buildRoles(claims, archetype, usedIds, style, ctx);
  const anchorDocumentId = anchored ? (anchorIds[0] ?? null) : null;

  const capabilities = [
    ...new Set(
      claims
        .flatMap((claim) => claim.capabilities)
        .filter((capability) => !(archetype?.deEmphasize ?? []).includes(capability)),
    ),
  ].slice(0, 12);

  const fallbackHeadline = identityHeadline(ctx, capabilities.slice(0, 2));
  const positioning = ctx.snapshot?.positioning;
  const fallbackSummary = [
    positioning
      ? ctx.phraser.pickByMove("summaryOpen", ctx.move, "open", {
          label: positioning.label,
          kinds: positioning.label.replace(/^Transferable /, "").split(", applied")[0] ?? "",
        })
      : thesis.winTheme,
    impactAnchors.length
      ? `Record includes ${impactAnchors
          .slice(0, 2)
          .map((a) => lowerStart(a.text))
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const roleTitleIds = new Set(
    [...ctx.classes.values()].filter((c) => c.semanticType === "ROLE_TITLE").map((c) => c.claimId),
  );

  const narrative = await generateWithFallback<{ headline: string; executiveSummary: string }>(
    "pursuit-resume-narrative",
    RESUME_NARRATIVE_INSTRUCTION,
    {
      mandate: {
        company: brief.company,
        roleTitle: brief.roleTitle,
        priorities: brief.mandatePriorities,
        outcomes: brief.mandateOutcomes,
      },
      winTheme: thesis.winTheme,
      privatePositioning: positioning ?? thesis.recommendedPositioning,
      lens: archetype
        ? { name: archetype.name, emphasize: archetype.emphasize, tone: archetype.tone }
        : null,
      verifiedClaims: claims.slice(0, 40).map((claim) => ({
        statement: claim.statement,
        employer: claim.employer,
        metric: claim.metricResult,
        relationshipToMandate: ctx.snapshot ? bestRelationship(ctx.snapshot.mappings, claim.id) : undefined,
      })),
      candidateStylePreferences: style.preferredPhrasings,
    },
    RESUME_NARRATIVE_SCHEMA,
    (raw) => raw as { headline: string; executiveSummary: string },
    input.model,
  );

  const draft: ResumeContent = {
    fullName: identity.fullName,
    contactLine: identity.contactLine,
    headline: narrative?.value.headline?.trim() || fallbackHeadline,
    executiveSummary: narrative?.value.executiveSummary?.trim() || fallbackSummary,
    impactAnchors,
    roles,
    capabilities,
    anchorDocumentId,
  };
  // Validators decide whether the model's language is licensed.
  const issues = validateResume(draft, brief.roleTitle, roleTitleIds);
  if (issues.some((i) => i.code === "TARGET_TITLE_HEADLINE" || (i.code === "LEAKAGE" && draft.headline !== fallbackHeadline && findLeakage(draft.headline).length)))
    draft.headline = fallbackHeadline;
  if (findLeakage(draft.executiveSummary).length > 0) draft.executiveSummary = fallbackSummary;
  return draft;
}

// ---------------------------------------------------------------------------
// Outreach messages
// ---------------------------------------------------------------------------

interface MessageSpec {
  type: ArtifactType;
  targetWords: number;
  brief: string;
}

/**
 * Deliberately not "a cover letter". At executive level the effective artefact is
 * a short, specific note pointed at one reader with one argument.
 */
const MESSAGE_SPECS: MessageSpec[] = [
  {
    type: "EXEC_NOTE",
    targetWords: 110,
    brief:
      "A direct note to the hiring executive. Open with the mandate as you understand it, not with yourself. One precedent that proves you have done it. One sentence proposing a short conversation. No preamble, no flattery.",
  },
  {
    type: "WARM_INTRO",
    targetWords: 95,
    brief:
      "A request to a mutual connection asking for an introduction. Make it effortless to forward: state the role, why you are credible in one line, and exactly what you are asking them to do.",
  },
  {
    type: "RECRUITER_BRIEF",
    targetWords: 170,
    brief:
      "A brief for the executive search consultant running the process. They need to sell you internally: give them the positioning, two or three proof points with scope, and pre-empt the obvious objection.",
  },
  {
    type: "APPLICATION_STATEMENT",
    targetWords: 130,
    brief:
      "The statement pasted into an application portal. It will be read alongside the resume by a screener, so it must be plain, concrete and free of narrative flourish.",
  },
  {
    type: "FOLLOW_UP_1",
    targetWords: 70,
    brief:
      "A day-5 follow-up after no reply. Add one new piece of value or perspective on the mandate. Never merely 'checking in'.",
  },
  {
    type: "FOLLOW_UP_2",
    targetWords: 60,
    brief:
      "A day-12 final follow-up. Gracious, brief, closes the loop, leaves the door open without pressing.",
  },
];

const MESSAGE_INSTRUCTION = `You are writing one outreach message for a senior executive candidate.

Absolute rules:
1. Only use candidate facts present in the supplied verified claims. Never invent an employer, title, date or metric.
2. Copy metrics exactly as written. Do not add a number that is not in the claims.
3. Respect the target word count within roughly 15 percent.
4. One argument per message, taken from the supplied win theme.
5. Ban: "I hope this finds you well", "I am writing to express my interest", "results-driven", "proven track record", "passionate", "perfect fit", "dream role", "synergy".
6. Do not use placeholders like [Name] except for the recipient's name, written as {{recipient}}. Never invent a real person's name.
7. Plain text. No markdown, no headings, no bullet lists unless the brief asks for them.
8. The writer is always the candidate, writing in the first person about their own record. You are never a recruiter, an agency or a third party writing about the candidate, and you never address the recipient as though they hold the candidate's achievements.
9. Use real line breaks between paragraphs. Never write an escape token such as {n}, \\n or <br> inside the body.
10. Each proof carries claimId and relationshipToMandate. Only DIRECT proof may be described as having done this before. ANALOGOUS proof is "closely related" or "comparable"; ADJACENT proof is "relevant supporting experience". Return proofAssertions with exact text spans from the body and their supporting claimIds.
11. The positioning is private strategy. Never write "present through", "lead with", "this lens", "positioning:" or any instruction to the candidate.
12. Never open with "As I read the ... mandate". Vary openings.`;

/**
 * Models occasionally emit newline tokens literally, which would otherwise show
 * up verbatim in the executive's own outgoing message.
 */
function normalizeMessageBody(value: string): string {
  return value
    .replace(/\{\s*n\s*\}/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/**
 * Written when no model provider is reachable. Each module still has to do its
 * own job — a single shared template would make six identical messages, which is
 * worse than useless to the candidate — so each one is drafted separately from
 * the thesis. Every sentence here is built from verified thesis fields only.
 */
function buildFallbackMessage(
  type: ArtifactType,
  input: {
    thesis: PursuitThesis;
    brief: RoleBrief;
    identity: CandidateIdentity;
    claims: readonly CandidateClaim[];
  },
  ctx: SemanticContext,
): string {
  const { thesis, brief, identity } = input;
  const role = brief.roleTitle;
  const vars = { role, company: brief.company };
  const p = ctx.phraser;
  const proofs = thesis.primaryProof;
  const proofLine = (index: number, slot: string) => {
    const proof = proofs[index];
    if (!proof) return null;
    const rel = relationshipOf(ctx, proof.claimId);
    const claim = input.claims.find((c) => c.id === proof.claimId);
    const where = claim?.employer ? ` at ${claim.employer}` : "";
    return `${p.proofLead(rel, `${type}:${slot}`)} ${lowerStart(proof.headline)}${where}.`;
  };
  const gap = ctx.snapshot?.positioning.gaps[0] ?? null;
  const label = ctx.snapshot?.positioning.label ?? thesis.winTheme;
  const objection = thesis.objections[0] ?? null;
  const sign = "\n" + identity.fullName;
  const lines = (...parts: Array<string | null>) =>
    parts.filter((part): part is string => Boolean(part)).join("\n\n") + "\n" + sign;

  switch (type) {
    case "EXEC_NOTE":
      // Job: create curiosity. One argument, one precedent, one ask.
      return lines(
        "{{recipient}} —",
        p.pickByMove("execOpener", ctx.move, "exec", vars),
        proofLine(0, "exec"),
        p.pick("execClose", "exec"),
      );
    case "WARM_INTRO":
      // Job: make the introduction easy and reputationally safe.
      return lines(
        "{{recipient}} —",
        `${brief.company} is hiring a ${role}. ${p.pick("warmAsk", "warm", vars)}`,
        "A short paragraph you can forward as-is:",
        `"${identity.fullName}: ${label}. ${proofLine(0, "warm-fwd") ?? ""} Interested in the ${role} mandate and happy to share more."`,
      );
    case "RECRUITER_BRIEF":
      // Job: equip the consultant to sell the candidate internally.
      return lines(
        "{{recipient}} —",
        `For the ${role} search at ${brief.company}, here is how I would frame my candidacy.`,
        `Mandate fit: ${label}.`,
        [proofLine(0, "rb1"), proofLine(1, "rb2"), proofLine(2, "rb3")].filter(Boolean).join("\n") || null,
        gap && ctx.snapshot
          ? p.pick("firstPersonGap", "rb-gap", {
              domain: ctx.snapshot.mandate.roleDomainLabel,
              kinds: ctx.snapshot.positioning.label.replace(/^Transferable /, "").split(", applied")[0] ?? "",
            })
          : objection
            ? `The likely question will be "${objection.objection.replace(/^They will test "|"\.?$/g, "")}". ${proofLine(1, "rb-obj") ?? ""}`.trim()
            : null,
        "Happy to take a call before you put me in front of the client.",
      );
    case "APPLICATION_STATEMENT":
      // Job: survive a skim and a keyword screen while making the case.
      return lines(
        `Application for ${role}, ${brief.company}.`,
        `${label}.`,
        [proofLine(0, "app1"), proofLine(1, "app2")].filter(Boolean).map((l) => `• ${l}`).join("\n") || null,
        gap && ctx.snapshot
          ? p.pick("firstPersonGap", "app-gap", {
              domain: ctx.snapshot.mandate.roleDomainLabel,
              kinds: ctx.snapshot.positioning.label.replace(/^Transferable /, "").split(", applied")[0] ?? "",
            })
          : null,
      );
    case "FOLLOW_UP_1": {
      // Job: add something new — an unused precedent or a sharp question.
      const fresh = proofLine(2, "fu1") ?? proofLine(1, "fu1");
      const question = brief.openQuestions[0];
      return lines(
        "{{recipient}} —",
        `${p.pick("followUpHook", "fu1")} ${fresh ?? ""}`.trim(),
        question ? `One question I would want to understand early: ${question}` : null,
      );
    }
    case "FOLLOW_UP_2":
      return lines("{{recipient}} —", p.pick("finalClose", "fu2", vars));
    default:
      return lines("{{recipient}} —", `On the ${role} mandate: ${thesis.targetMandate}`);
  }
}

function fallbackSubject(
  type: ArtifactType,
  input: { brief: RoleBrief; identity: CandidateIdentity },
): string {
  const { brief, identity } = input;
  switch (type) {
    case "WARM_INTRO":
      return `Introduction request — ${brief.roleTitle}, ${brief.company}`;
    case "RECRUITER_BRIEF":
      return `${brief.roleTitle}, ${brief.company} — candidate brief: ${identity.fullName}`;
    case "APPLICATION_STATEMENT":
      return `Application — ${brief.roleTitle}, ${brief.company}`;
    case "FOLLOW_UP_1":
      return `Following up — ${brief.roleTitle}`;
    case "FOLLOW_UP_2":
      return `Closing the loop — ${brief.roleTitle}`;
    default:
      return `${brief.roleTitle} — ${identity.fullName}`;
  }
}

const MESSAGE_PACKAGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          proofAssertions: { type: "array", items: { type: "object", properties: {
            text: { type: "string" }, claimIds: { type: "array", items: { type: "string" } },
          }, required: ["text", "claimIds"], additionalProperties: false } },
        },
        required: ["type", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["messages"],
  additionalProperties: false,
};

interface DraftedMessage {
  type: string;
  subject: string;
  body: string;
  proofAssertions?: Array<{ text: string; claimIds: string[] }>;
}

/**
 * One call for the whole outreach set.
 *
 * Every message shares the same mandate, win theme, proof points and verified
 * claims; sending that context six times cost six times the input tokens for no
 * added quality, and let the six notes drift into near-duplicates because no
 * single call could see its siblings. Generating them together lets the model
 * keep the openings and arguments distinct, and any message that fails to come
 * back or fails validation still falls back deterministically on its own.
 */
export async function generateMessagePackage(input: {
  thesis: PursuitThesis;
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  identity: CandidateIdentity;
  style: StyleProfile;
  /** Usage sink and token ceiling for this derivation. */
  model?: PursuitModelContext;
}): Promise<Record<string, MessageContent>> {
  const ctx = semanticContext(input.thesis, input.claims, "outreach");
  const strongest = strongestProof(ctx, input.thesis);

  const result = await generateWithFallback<{ messages: DraftedMessage[] }>(
    "pursuit-outreach-package",
    `${MESSAGE_INSTRUCTION}

You are writing ALL of the messages listed under "messagesToWrite" in one response.
Return one entry per requested type, using exactly the given type string.
Each message must open differently and lead with a different angle from the others:
the reader may see more than one, and repetition destroys credibility.`,
    {
      candidateName: input.identity.fullName,
      mandate: {
        company: input.brief.company,
        roleTitle: input.brief.roleTitle,
        priorities: input.brief.mandatePriorities,
        whyNow: input.brief.whyNow,
        hiringDriver: input.brief.primaryDriver,
      },
      winTheme: input.thesis.winTheme,
      positioning: ctx.snapshot?.positioning ?? null,
      proofPoints: input.thesis.primaryProof.map((proof) => ({
        claimId: proof.claimId,
        statement: proof.headline,
        whyItMatters: proof.whyItMatters,
        relationshipToMandate: relationshipOf(ctx, proof.claimId),
      })),
      likelyObjection: input.thesis.objections[0] ?? null,
      narrativesToAvoid: input.thesis.narrativesToAvoid,
      verifiedClaims: input.claims.slice(0, 30).map((claim) => ({
        claimId: claim.id,
        statement: claim.statement,
        employer: claim.employer,
        metric: claim.metricResult,
      })),
      candidateStylePreferences: input.style.preferredPhrasings,
      messagesToWrite: MESSAGE_SPECS.map((spec) => ({
        type: spec.type,
        targetWords: spec.targetWords,
        brief: spec.brief,
      })),
    },
    MESSAGE_PACKAGE_SCHEMA,
    (raw) => raw as { messages: DraftedMessage[] },
    input.model,
  );

  const drafted = new Map<string, DraftedMessage>();
  for (const entry of result?.value.messages ?? []) {
    if (entry && typeof entry.type === "string") drafted.set(entry.type, entry);
  }

  const out: Record<string, MessageContent> = {};
  const proofRelationships = ctx.snapshot?.proofRelationships ?? {};
  const assertionsFor = (body: string) => input.thesis.primaryProof.flatMap((proof) => {
    if (!proof.claimId) return [];
    const paragraph = body.split(/\n\s*\n/).find((part) =>
      part.toLowerCase().includes(proof.headline.toLowerCase()));
    return paragraph ? [{ text: paragraph, claimIds: [proof.claimId] }] : [];
  });
  for (const spec of MESSAGE_SPECS) {
    const fallback = normalizeMessageBody(buildFallbackMessage(spec.type, input, ctx));
    const hit = drafted.get(spec.type);
    const candidate: MessageContent = {
      subject: hit?.subject?.trim() || fallbackSubject(spec.type, input),
      body: normalizeMessageBody(hit?.body ?? "") || fallback,
      targetWords: spec.targetWords,
      proofAssertions: hit?.proofAssertions ?? assertionsFor(hit?.body ?? fallback),
    };
    const fallbackContent: MessageContent = {
      ...candidate, body: fallback, proofAssertions: assertionsFor(fallback),
    };
    out[spec.type] =
      validateMessage(candidate, strongest).length > 0 ||
      ledgerApprovalBlockers({ kind: "MESSAGE", message: candidate }, {
        claims: [...input.claims], proofRelationships, contextText: JSON.stringify(input.brief),
      }).length > 0 ? fallbackContent : candidate;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interview brief
// ---------------------------------------------------------------------------

const INTERVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    mandateSentence: { type: "string" },
    proofStories: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          challenge: { type: "string" },
          action: { type: "string" },
          scale: { type: "string" },
          result: { type: "string" },
          relevance: { type: "string" },
          claimIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "challenge", "action", "scale", "result", "relevance", "claimIds"],
        additionalProperties: false,
      },
    },
    questionsToAsk: { type: "array", items: { type: "string" }, maxItems: 6 },
    firstNinetyDays: { type: "array", items: { type: "string" }, maxItems: 4 },
    risksToAddress: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: [
    "mandateSentence",
    "proofStories",
    "questionsToAsk",
    "firstNinetyDays",
    "risksToAddress",
  ],
  additionalProperties: false,
};

const INTERVIEW_INSTRUCTION = `Prepare an executive interview brief for one candidate against one mandate.

Absolute rules:
1. Every proof story must be built from the supplied verified claims and must cite their claimIds. Never invent a situation, employer, number or outcome. If the claims do not support three stories, return fewer.
2. Copy metrics exactly as written in the claims.
3. If the claims do not establish the challenge, the personal action, or a distinct result, leave that field empty — never write a placeholder or repeat the action as the result.
4. Each story has: challenge (what was wrong), action (what this person did), scale (scope, team, budget, geography as evidenced), result (the outcome as recorded), relevance (why it answers this mandate).
4. questionsToAsk must be the questions that resolve genuine unknowns about the role — reporting line, authority, mandate, resourcing, success definition. Use the supplied open questions where given. No flattering questions.
5. firstNinetyDays are hypotheses stated as hypotheses, not promises.
6. risksToAddress are what a sceptical panel will probe, drawn from the supplied objections.
7. Plain prose in every field. No markdown.`;

/**
 * Evidence-first proof stories: one per bundle behind the ranked proof. Known
 * facts are listed; what the ledger cannot supply is named as missing rather
 * than filled with placeholders. Such stories are INCOMPLETE, feeding profile
 * enrichment.
 */
function evidenceStories(thesis: PursuitThesis, claims: readonly CandidateClaim[]): ProofStory[] {
  const ctx = semanticContext(thesis, claims, "interview");
  const seen = new Set<string>();
  const stories: ProofStory[] = [];
  for (const proof of thesis.primaryProof) {
    const claim = claims.find((c) => c.id === proof.claimId);
    if (!claim) continue;
    const bundle = ctx.snapshot?.bundles.find((b) => b.claimIds.includes(claim.id));
    const key = bundle?.id ?? claim.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const related = claims.filter(
      (c) =>
        bundle?.claimIds.includes(c.id) &&
        c.id !== claim.id &&
        ctx.classes.get(c.id)?.semanticType !== "ROLE_TITLE" &&
        (ctx.relevance.get(c.id) ?? 0) > 0,
    );
    const outcome = [claim, ...related].find((c) => ctx.classes.get(c.id)?.semanticType === "OUTCOME");
    const scale = related.filter((c) => ["SCOPE", "METRIC"].includes(ctx.classes.get(c.id)?.semanticType ?? ""));
    stories.push(
      gradeStory({
        title: `${claim.employer ?? "Record"}: ${claim.statement}`.slice(0, 90),
        challenge: "",
        action: "",
        scale: scale.map((c) => c.statement).join("; "),
        result: outcome?.statement ?? "",
        relevance: proof.whyItMatters,
        claimIds: [claim.id, ...related.map((c) => c.id)].slice(0, 4),
        knownFacts: [claim.statement, ...related.map((c) => c.statement)].slice(0, 4),
      }),
    );
  }
  return stories.slice(0, 3);
}

export async function generateInterviewBrief(input: {
  thesis: PursuitThesis;
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  /** Usage sink and token ceiling for this derivation. */
  model?: PursuitModelContext;
}): Promise<InterviewBriefContent> {
  const allowed = new Set(input.claims.map((claim) => claim.id));

  const fallback: InterviewBriefContent = {
    mandateSentence: input.thesis.targetMandate,
    proofStories: evidenceStories(input.thesis, input.claims),
    questionsToAsk:
      input.brief.openQuestions.length > 0
        ? input.brief.openQuestions.slice(0, 6)
        : [
            "Who does this role report to, and how far is that from the decision on budget?",
            "What does success look like twelve months in, in numbers?",
            "Is this a build, a scale-up, or a turnaround of something already running?",
          ],
    firstNinetyDays: [
      "Establish the baseline: what is actually measured today and how reliably.",
      "Identify the one outcome that would visibly de-risk the mandate.",
      "Map the stakeholders whose cooperation the mandate quietly depends on.",
    ],
    risksToAddress: input.thesis.objections.map((objection) => objection.objection),
  };

  const result = await generateWithFallback<InterviewBriefContent>(
    "pursuit-interview-brief",
    INTERVIEW_INSTRUCTION,
    {
      mandate: {
        company: input.brief.company,
        roleTitle: input.brief.roleTitle,
        priorities: input.brief.mandatePriorities,
        outcomes: input.brief.mandateOutcomes,
        requirements: input.brief.requirements,
        knownRisk: input.brief.primaryRisk,
      },
      openQuestionsFromDossier: input.brief.openQuestions,
      thesis: {
        targetMandate: input.thesis.targetMandate,
        winTheme: input.thesis.winTheme,
        objections: input.thesis.objections,
      },
      verifiedClaims: input.claims.slice(0, 60).map((claim) => ({
        claimId: claim.id,
        statement: claim.statement,
        employer: claim.employer,
        roleTitle: claim.roleTitle,
        metric: claim.metricResult,
      })),
    },
    INTERVIEW_SCHEMA,
    (raw) => raw as InterviewBriefContent,
    input.model,
  );

  if (!result) return fallback;

  const stories: ProofStory[] = (result.value.proofStories ?? [])
    .map((story) => ({
      ...story,
      claimIds: (story.claimIds ?? []).filter((id) => allowed.has(id)),
    }))
    // A story with no surviving citation is unverifiable; drop it rather than ship it.
    .filter((story) => story.claimIds.length > 0);

  const graded = stories.map((story) => {
    const known = story.claimIds
      .map((id) => input.claims.find((c) => c.id === id)?.statement)
      .filter((v): v is string => Boolean(v));
    return gradeStory({ ...story, knownFacts: known });
  });
  return {
    mandateSentence: result.value.mandateSentence?.trim() || fallback.mandateSentence,
    proofStories: graded.length > 0 ? graded : fallback.proofStories,
    questionsToAsk:
      result.value.questionsToAsk?.length > 0 ? result.value.questionsToAsk : fallback.questionsToAsk,
    firstNinetyDays:
      result.value.firstNinetyDays?.length > 0
        ? result.value.firstNinetyDays
        : fallback.firstNinetyDays,
    risksToAddress:
      result.value.risksToAddress?.length > 0
        ? result.value.risksToAddress
        : fallback.risksToAddress,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface GeneratedArtifact {
  artifactType: ArtifactType;
  content: ArtifactContent;
  renderedText: string;
}

export function renderMessage(message: MessageContent): string {
  return message.subject ? `Subject: ${message.subject}\n\n${message.body}` : message.body;
}

export function renderResume(resume: ResumeContent): string {
  const lines = [resume.fullName, resume.contactLine, resume.headline, ""];
  if (resume.executiveSummary) lines.push("EXECUTIVE SUMMARY", resume.executiveSummary, "");
  if (resume.impactAnchors.length > 0) {
    lines.push("SELECTED IMPACT");
    for (const anchor of resume.impactAnchors) lines.push(`• ${anchor.text}`);
    lines.push("");
  }
  for (const role of resume.roles) {
    lines.push(`${role.roleTitle}${role.employer ? ` — ${role.employer}` : ""}`);
    for (const bullet of role.bullets) lines.push(`• ${bullet.text}`);
    lines.push("");
  }
  if (resume.capabilities.length > 0) {
    lines.push("CAPABILITIES", resume.capabilities.join(" · "));
  }
  return lines.join("\n");
}

export function renderInterviewBrief(brief: InterviewBriefContent): string {
  const lines = ["THE MANDATE", brief.mandateSentence, ""];
  brief.proofStories.forEach((story, index) => {
    lines.push(
      `PROOF STORY ${index + 1}: ${story.title}`,
      `Challenge: ${story.challenge}`,
      `Action: ${story.action}`,
      `Scale: ${story.scale}`,
      `Result: ${story.result}`,
      `Relevance: ${story.relevance}`,
      "",
    );
  });
  lines.push("QUESTIONS TO ASK", ...brief.questionsToAsk.map((q) => `• ${q}`), "");
  lines.push("FIRST 90 DAYS", ...brief.firstNinetyDays.map((h) => `• ${h}`), "");
  lines.push("RISKS TO ADDRESS", ...brief.risksToAddress.map((r) => `• ${r}`));
  return lines.join("\n");
}

/** Generate the full artifact set for a thesis. Providers are called in parallel. */
export async function generateArtifactSet(input: {
  identity: CandidateIdentity;
  thesis: PursuitThesis;
  brief: RoleBrief;
  claims: readonly CandidateClaim[];
  archetype: CandidateArchetype | null;
  style: StyleProfile;
  /** Usage sink and token ceiling for this derivation. */
  model?: PursuitModelContext;
}): Promise<GeneratedArtifact[]> {
  // Three provider calls for the whole package (resume, interview brief, the
  // consolidated outreach set) instead of one per artifact.
  const [resume, interviewBrief, messages] = await Promise.all([
    generateResume(input),
    generateInterviewBrief(input),
    generateMessagePackage(input),
  ]);

  const artifacts: GeneratedArtifact[] = [
    {
      artifactType: "RESUME",
      content: { kind: "RESUME", resume },
      renderedText: renderResume(resume),
    },
    {
      artifactType: "INTERVIEW_BRIEF",
      content: { kind: "INTERVIEW_BRIEF", brief: interviewBrief },
      renderedText: renderInterviewBrief(interviewBrief),
    },
  ];

  MESSAGE_SPECS.forEach((spec) => {
    const message = messages[spec.type] as MessageContent;
    artifacts.push({
      artifactType: spec.type,
      content: { kind: "MESSAGE", message },
      renderedText: renderMessage(message),
    });
  });

  return artifacts;
}
