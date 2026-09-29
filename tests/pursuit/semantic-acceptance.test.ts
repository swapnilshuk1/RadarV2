/**
 * Frozen semantic acceptance corpus for the Pursuit Cockpit.
 *
 * Three matching situations on one candidate:
 *   GlobalLogic — weak direct domain, strong transferable capability.
 *   WPP         — strong direct domain evidence.
 *   Antal       — genuine lateral-domain transfer.
 *
 * No live model: the adapter is mocked so the deterministic engine and the
 * validators are what is certified. Assertions test behaviour, never prose.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../src/pursuit/model", () => ({ generateWithFallback: async () => null }));

import { deriveDeterministicThesis } from "../../src/pursuit/thesis";
import { generateArtifactSet } from "../../src/pursuit/artifacts";
import { ledgerApprovalBlockers } from "../../src/pursuit/approval";
import { relate, classifyClaim } from "../../src/pursuit/semantic/engine";
import { findLeakage } from "../../src/pursuit/semantic/validate";
import type { RoleBrief } from "../../src/pursuit/role-brief";
import type {
  CandidateArchetype,
  CandidateClaim,
  InterviewBriefContent,
  MessageContent,
  PursuitThesis,
  ResumeContent,
  StyleProfile,
} from "../../src/pursuit/types";

const FIXTURES = path.join(__dirname, "../fixtures/pursuit");
const load = <T>(p: string): T => JSON.parse(readFileSync(path.join(FIXTURES, p), "utf-8")) as T;

const claims = load<CandidateClaim[]>("candidate-claims.json");
const archetypes = load<CandidateArchetype[]>("archetypes.json");
const style: StyleProfile = {
  preferredPhrasings: [],
  promotedClaimIds: [],
  rejectedClaimIds: [],
  archetypeOverrides: [],
  observedEditCount: 0,
};
const identity = { fullName: "Swapnil Shukla", contactLine: "" };

const CASES = {
  globallogic: load<RoleBrief>("globallogic-data-ai/role.json"),
  wpp: load<RoleBrief>("wpp-client-services/role.json"),
  antal: load<RoleBrief>("antal-managing-partner/role.json"),
};
type Key = keyof typeof CASES;

interface Result {
  thesis: PursuitThesis;
  resume: ResumeContent;
  messages: Record<string, MessageContent>;
  interview: InterviewBriefContent;
}
const results = {} as Record<Key, Result>;

const claimBy = (re: RegExp) => claims.find((c) => re.test(c.statement))!;
const FEE_BOOK = claimBy(/fee book/i);
const PERF_BUDGET = claimBy(/performance marketing budget/i);

beforeAll(async () => {
  for (const key of Object.keys(CASES) as Key[]) {
    const brief = CASES[key];
    const derived = deriveDeterministicThesis({
      brief,
      claims,
      archetypes,
      style,
      seed: `fixture-${key}`,
    });
    const thesis: PursuitThesis = {
      ...derived,
      id: `t-${key}`,
      pursuitId: `p-${key}`,
      version: 1,
      createdAt: "",
    };
    const archetype = archetypes.find((a) => a.id === thesis.archetypeId) ?? null;
    const artifacts = await generateArtifactSet({
      identity,
      thesis,
      brief,
      claims,
      archetype,
      style,
    });
    const messages: Record<string, MessageContent> = {};
    let resume!: ResumeContent;
    let interview!: InterviewBriefContent;
    for (const a of artifacts) {
      if (a.content.kind === "RESUME") resume = a.content.resume;
      else if (a.content.kind === "INTERVIEW_BRIEF") interview = a.content.brief;
      else messages[a.artifactType] = a.content.message;
    }
    results[key] = { thesis, resume, messages, interview };
  }
});

const dimension = (key: Key, kind: string) =>
  results[key].thesis.semantic!.mandate.dimensions.find((d) => d.kind === kind);
const coverage = (key: Key, kind: string) => {
  const d = dimension(key, kind);
  return results[key].thesis.semantic!.coverage.find((c) => c.dimensionId === d?.id);
};
const edge = (key: Key, kind: string, claim: CandidateClaim) => {
  const d = dimension(key, kind);
  if (!d) return null;
  return relate(d, claim, classifyClaim(claim))?.relationship ?? null;
};
const allText = (r: Result) =>
  Object.values(r.messages)
    .map((m) => m.body)
    .join("\n");

describe("GlobalLogic — Data & AI service line", () => {
  it("does not position as Digital Marketing", () => {
    const p = results.globallogic.thesis.semantic!.positioning;
    expect(p.domain).not.toBe("DIGITAL_MARKETING");
    expect(p.label.toLowerCase()).not.toContain("digital marketing");
    expect(p.domain).toBe("DATA_AI_SERVICES");
  });
  it("does not find DIRECT Data & AI practice ownership and surfaces the gap", () => {
    expect(coverage("globallogic", "CORE_DOMAIN_DELIVERY")!.best).not.toBe("DIRECT");
    expect(results.globallogic.thesis.semantic!.positioning.gaps.join(" ")).toMatch(/data & ai/i);
  });
  it("never treats a marketing budget as DIRECT evidence of the practice", () => {
    expect(edge("globallogic", "CORE_DOMAIN_DELIVERY", PERF_BUDGET)).not.toBe("DIRECT");
    expect(edge("globallogic", "COMMERCIAL_OWNERSHIP", PERF_BUDGET)).not.toBe("DIRECT");
  });
  it("outreach never claims prior execution of the mandate", () => {
    expect(allText(results.globallogic)).not.toMatch(/i have done this before/i);
  });
});

describe("WPP — AVP Client Services", () => {
  it("leads with agency / client leadership", () => {
    const p = results.wpp.thesis.semantic!.positioning;
    expect(p.mode).toBe("DIRECT_DOMAIN");
    expect(p.domain).toBe("AGENCY_CLIENT_SERVICES");
  });
  it("recognises VML / WPP evidence as direct domain evidence", () => {
    expect(coverage("wpp", "CORE_DOMAIN_DELIVERY")!.best).toBe("DIRECT");
    expect(edge("wpp", "COMMERCIAL_OWNERSHIP", FEE_BOOK)).toBe("DIRECT");
  });
  it("ranks the fee book above the performance budget", () => {
    const ids = results.wpp.thesis.primaryProof.map((p) => p.claimId);
    expect(ids).toContain(FEE_BOOK.id);
    const budgetIdx = ids.indexOf(PERF_BUDGET.id);
    expect(budgetIdx === -1 || budgetIdx > ids.indexOf(FEE_BOOK.id)).toBe(true);
  });
  it("never makes a generic trait a MATERIAL objection", () => {
    const material = results.wpp.thesis.objections.filter((o) => o.severity === "MATERIAL");
    expect(material.some((o) => /inquisitive|entrepreneurial/i.test(o.objection))).toBe(false);
    expect(results.wpp.thesis.objections.some((o) => /inquisitive/i.test(o.objection))).toBe(false);
  });
  it("uses candidate identity, not the target title, as headline", () => {
    expect(results.wpp.resume.headline.toLowerCase()).not.toContain(
      "associate vice president, client services",
    );
  });
});

describe("Antal — Managing Partner (lateral move)", () => {
  it("treats agency and executive search as distinct domains", () => {
    const p = results.antal.thesis.semantic!.positioning;
    expect(p.domain).toBe("EXECUTIVE_SEARCH");
    expect(p.mode).toBe("LATERAL");
    expect(edge("antal", "CORE_DOMAIN_DELIVERY", FEE_BOOK)).not.toBe("DIRECT");
  });
  it("preserves commercial analogues", () => {
    const rel = edge("antal", "COMMERCIAL_OWNERSHIP", FEE_BOOK);
    expect(rel === "ANALOGOUS" || rel === "DIRECT").toBe(true);
  });
  it("surfaces the executive-search gap explicitly", () => {
    expect(results.antal.thesis.semantic!.positioning.gaps.join(" ")).toMatch(
      /executive-search|executive search/i,
    );
    expect(results.antal.thesis.objections.some((o) => o.severity === "MATERIAL")).toBe(true);
  });
  it("never says 'I have done this before' on agency evidence", () => {
    expect(allText(results.antal)).not.toMatch(/i have done this before/i);
  });
});

describe("Universal contracts", () => {
  const keys = Object.keys(CASES) as Key[];

  it("positions the three mandates differently", () => {
    const ids = keys.map((k) => results[k].thesis.semantic!.positioning.id);
    expect(new Set(ids).size).toBe(3);
  });
  it("maps the same claim differently across mandates (distance lives on the edge)", () => {
    expect(edge("wpp", "COMMERCIAL_OWNERSHIP", FEE_BOOK)).toBe("DIRECT");
    expect(edge("antal", "CORE_DOMAIN_DELIVERY", FEE_BOOK)).not.toBe("DIRECT");
    expect(edge("globallogic", "CORE_DOMAIN_DELIVERY", FEE_BOOK)).not.toBe("DIRECT");
  });
  it.each(keys)("%s: no strategy directives in candidate artifacts", (k) => {
    const r = results[k];
    expect(findLeakage(`${r.resume.headline}\n${r.resume.executiveSummary}`)).toEqual([]);
    for (const m of Object.values(r.messages)) expect(findLeakage(m.body)).toEqual([]);
  });
  it.each(keys)("%s: target title never becomes the headline", (k) => {
    expect(results[k].resume.headline.toLowerCase()).not.toContain(
      CASES[k].roleTitle.toLowerCase(),
    );
  });
  it.each(keys)("%s: role-title claims never become impact bullets", (k) => {
    for (const a of results[k].resume.impactAnchors) {
      const claim = claims.find((c) => c.id === a.claimId);
      if (claim) expect(classifyClaim(claim).semanticType).not.toBe("ROLE_TITLE");
    }
  });
  it.each(keys)("%s: DIRECT-only language only with DIRECT evidence", (k) => {
    const r = results[k];
    const direct = Object.values(r.thesis.semantic!.proofRelationships).includes("DIRECT");
    if (!direct)
      expect(allText(r)).not.toMatch(
        /i have done this before|a direct precedent|work i have already owned/i,
      );
  });
  it.each(keys)("%s: READY stories are complete; others list what is missing", (k) => {
    for (const s of results[k].interview.proofStories) {
      if (s.status === "READY") {
        expect(s.challenge && s.action && s.result).toBeTruthy();
        expect(s.action).not.toBe(s.result);
      } else {
        expect(s.status).toBe("INCOMPLETE");
        expect(s.missingFields?.length ?? 0).toBeGreaterThan(0);
      }
    }
    expect(
      ledgerApprovalBlockers(
        { kind: "INTERVIEW_BRIEF", brief: results[k].interview },
        { claims },
      ).join(" "),
    ).not.toMatch(/changes a figure/);
  });
  it("opening lines, proof lead-ins and counter-frames vary across mandates", () => {
    const openers = keys.map((k) => results[k].messages.EXEC_NOTE!.body.split("\n\n")[1]);
    expect(new Set(openers).size).toBe(3);
    const counters = keys.map((k) => results[k].thesis.objections[0]?.counterPosition ?? k);
    expect(new Set(counters).size).toBe(3);
  });
  it.each(keys)("%s: no phrase repeats inside one package", (k) => {
    const lines = Object.values(results[k].messages)
      .flatMap((m) => m.body.split("\n"))
      .map((l) => l.trim())
      .filter((l) => l.length > 30 && !l.startsWith("•") && !l.startsWith('"'));
    const openings = lines.map((l) => l.split(/[:.]/)[0]);
    expect(new Set(openings).size).toBe(openings.length);
  });
});
