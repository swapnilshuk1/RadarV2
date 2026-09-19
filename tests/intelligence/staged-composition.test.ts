import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { GoogleAuth } from "google-auth-library";
import { adcTokenProvider } from "../../src/lib/model/google-adc";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { durableDossierModel } from "../../src/lib/intelligence/staged/DurableDossierModel";
import { dossier as fixtureDossier, stagedEvaluation } from "../fixtures/staged-rich-dossier";
import { reviewMemo } from "../../src/dossier/memo-review";
import { memoInputPacket, validateMemoCopy } from "../../src/dossier/composition";
import { compositionSchema } from "../../src/dossier/contracts";
import { allPassages } from "../../src/dossier/grounding";
import { propose } from "../../src/dossier/evidence";
import { assertFactualReviewProvenance } from "../../src/dossier/factual-review-integrity";
import { bindStagedEditorial, composeStagedDossier } from "../../src/dossier/staged-composition";
import { runStagedFrozenDecisionDetailed } from "../../src/dossier/staged-decision";
import {
  ModelProviderUnavailableError,
  providerRetryAfterMs,
} from "../../src/lib/model/provider-unavailable";
import { createGeminiFactualReviewModel } from "../../src/lib/model/gemini-factual-review-model";
import type { StagedResearchInput } from "../../src/dossier/staged-role";
import { parseCanonicalStagedDecisionResult } from "../../src/dossier/staged-decision-integrity";

const frozen: StagedResearchInput = {
  opportunity: { id: "job", company: "Company", title: "Head" },
  candidate: { name: "Candidate" },
  sources: [
    {
      id: "jd",
      plane: "JD",
      title: "JD",
      locator: "jd",
      text: "Lead growth.",
      capturedAt: "2026-01-01",
    },
    {
      id: "cv",
      plane: "CANDIDATE",
      title: "CV",
      locator: "cv",
      text: "Led growth.",
      capturedAt: "2026-01-01",
    },
  ],
  evidence: [
    {
      id: "JD-1-1",
      text: "Lead growth.",
      plane: "JD",
      state: "EXPLICIT",
      confidence: 1,
      citations: [{ sourceId: "jd", quote: "Lead growth." }],
      derivedFrom: [],
    },
    {
      id: "CANDIDATE-1-1",
      text: "Led growth.",
      plane: "CANDIDATE",
      state: "EXPLICIT",
      confidence: 1,
      citations: [{ sourceId: "cv", quote: "Led growth." }],
      derivedFrom: [],
    },
  ],
  candidateSourceRefs: [],
  candidateConflicts: [],
  acquisition: [],
  validEvidenceClaimIds: ["JD-1-1", "CANDIDATE-1-1"],
  fields: [],
  fingerprint: "input",
};
const editorial = {
  rationale: "Authority merits a deliberate career choice.",
  narrativePlan: {
    roleArchetype: "Growth",
    mandateShape: "Build",
    careerMove: "Lateral",
    authorityShape: "Function",
    fitShape: "Direct",
    evidenceShape: "Precedent",
    decisionTension: "Authority",
    companyTrajectory: "Unresolved",
    argument: "Assess authority before pursuing.",
    emphasis: ["Authority"],
    sectionOrder: ["executiveThesis"],
    claimIds: ["JD-1-1", "CANDIDATE-1-1"],
  },
};
const axis = {
  material: false,
  candidateClaimIds: [],
  operatingConditionIds: [],
  resolutionFields: [],
};
const decision = {
  verdict: "PASS",
  screeningViability: "PLAUSIBLE",
  decisionHinges: [{ requirementIds: [], resolutionFields: ["authority"] }],
  reopeningConditions: [],
  screeningDriverRequirementIds: [],
  careerCapital: { authority: axis, scope: axis, functionalAltitude: axis, compensation: axis },
} as const;
const staged = parseCanonicalStagedDecisionResult({
  decision,
  trace: {
    decision,
    role: {
      requirements: [
        {
          id: "REQ-001",
          requirement: "Growth capability",
          strength: "PREFERRED",
          roleImportance: "CORE_CAPABILITY",
          roleClaimIds: ["JD-1-1"],
          reasoning: "Delivery",
        },
      ],
      operatingConditions: [],
      authorityShape: "Function",
      roleSideConditions: [],
    },
    requirements: [
      {
        id: "REQ-001",
        requirement: "Growth capability",
        strength: "PREFERRED",
        roleImportance: "CORE_CAPABILITY",
        roleClaimIds: ["JD-1-1"],
        reasoning: "Delivery",
        screeningGate: false,
        screeningFunction: "ROLE_PERFORMANCE_REQUIREMENT",
        screeningGateBasis: "NONE",
        screeningSupportQuoteIds: ["REQ-001:Q1"],
        screeningReasoning: "Performance",
        status: "DIRECT",
        candidateClaimIds: ["CANDIDATE-1-1"],
        unsupportedAspects: [],
        mappingReasoning: "Direct growth precedent",
      },
    ],
    resolutions: [
      {
        field: "authority",
        status: "OPEN",
        value: null,
        claimIds: [],
        methods: ["ask"],
        question: "What authority?",
        consequence: "Changes career value.",
      },
    ],
    eligibleScreeningDrivers: [],
    screeningConstraint: "NONE",
  },
});

const seed = fixtureDossier();
const draft = () => ({
  rationale: seed.verdict.rationale,
  narrativePlan: structuredClone(seed.narrativePlan),
  memo: compositionSchema.parse(seed),
});
const research = () =>
  bindStagedEditorial(frozen, stagedEvaluation, {
    rationale: seed.verdict.rationale,
    narrativePlan: seed.narrativePlan,
  });
const accept = (input: any) => ({
  checks: input.passages.map((p: any) => ({
    passageId: p.passageId,
    sourceClaimIds: p.evidenceRefs,
    assessment: "Fixture comparison supports the assertion.",
    supported: true,
  })),
  acceptedPassageIds: input.passages.map((p: any) => p.passageId),
  coveredPointIds: input.assignedPoints.map((p: any) => p.id),
  defects: [],
  suggestions: [],
});
describe("staged dossier editorial boundary", () => {
  it("carries earlier repair constraints forward instead of oscillating between defects", async () => {
    let calls = 0;
    const model = {
      id: "cumulative-repair",
      version: "1",
      async generate(_instruction: string, input: any) {
        calls++;
        if (calls === 3) {
          expect(input.repair).toContain("unsupported premise");
          expect(input.repair).toContain("missing qualification");
        }
        return { attempt: calls };
      },
    };
    expect(
      await propose(model, "memo", {}, (value: any) => {
        if (value.attempt === 1) throw new Error("unsupported premise");
        if (value.attempt === 2) throw new Error("missing qualification");
        return value;
      }),
    ).toEqual({ attempt: 3 });
  });
  it("uses short transient backoff and preserves explicit provider retry metadata", async () => {
    expect(new ModelProviderUnavailableError("Throttle", 429).retryAfterMs).toBe(30_000);
    expect(new ModelProviderUnavailableError("Capacity", 503).retryAfterMs).toBe(30_000);
    expect(new ModelProviderUnavailableError("Auth", 403).retryAfterMs).toBe(900_000);
    const now = Date.parse("2026-09-19T00:00:00Z");
    expect(
      await providerRetryAfterMs(
        new Response("", { headers: { "Retry-After": "Sat, 19 Sep 2026 00:02:00 GMT" } }),
        now,
      ),
    ).toBe(120_000);
    expect(
      await providerRetryAfterMs(
        new Response("not JSON", { headers: { "Retry-After": "invalid" } }),
        now,
      ),
    ).toBeUndefined();
    expect(
      await providerRetryAfterMs(
        new Response(
          JSON.stringify({
            error: {
              details: [
                { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45.5s" },
              ],
            },
          }),
        ),
      ),
    ).toBe(45_500);
  });
  it("passes a Gemini quota hint through the reviewer boundary without repeated calls or leaking the body", async () => {
    let calls = 0;
    const reviewer = createGeminiFactualReviewModel({
      projectId: "test-project",
      token: async () => "secret",
      request: async () => {
        calls++;
        return new Response("private provider body", {
          status: 429,
          headers: { "Retry-After": "90" },
        });
      },
    });
    const error = await reviewer.generate("review", {}).catch((error) => error);
    expect(error).toBeInstanceOf(ModelProviderUnavailableError);
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterMs).toBe(90_000);
    expect(calls).toBe(1);
    expect(error.message).not.toContain("private provider body");
  });
  it.each(["TimeoutError", "network"])(
    "uses a short durable delay for %s without a status code",
    async (mode) => {
      const reviewer = createGeminiFactualReviewModel({
        projectId: "test-project",
        token: async () => "secret",
        request: async () => {
          throw mode === "TimeoutError"
            ? new DOMException("provider timeout", "TimeoutError")
            : new TypeError("fetch failed");
        },
      });
      const error = await reviewer.generate("review", {}).catch((error) => error);
      expect(error).toBeInstanceOf(ModelProviderUnavailableError);
      expect(error.retryAfterMs).toBe(30_000);
    },
  );
  it("does not trap a resumed composition in rejected cached proposals", async () => {
    const db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    let valid = false,
      calls = 0;
    const model = durableDossierModel(db, "proposal-retry", {
      id: "repairable-proposal",
      version: "1",
      async generate() {
        calls++;
        return { valid };
      },
    });
    const validate = (value: any) => {
      if (!value.valid) throw new Error("Invalid proposal");
      return value;
    };
    await expect(propose(model, "compose", {}, validate)).rejects.toThrow("Invalid proposal");
    expect(
      (await db.one<{ n: number }>("SELECT COUNT(*) n FROM dossier_model_checkpoints"))!.n,
    ).toBeGreaterThan(0);
    const beforeResume = calls;
    valid = true;
    expect(await propose(model, "compose", {}, validate)).toEqual({ valid: true });
    expect(calls).toBe(beforeResume + 1);
  });
  it("pauses on reviewer infrastructure failure without exposing provider bodies", async () => {
    const reviewer = createGeminiFactualReviewModel({
      projectId: "test-project",
      token: async () => "private-token",
      request: async (_url, options) => {
        expect(JSON.parse(options!.body as string).generationConfig.thinkingConfig).toEqual({
          thinkingLevel: "MEDIUM",
        });
        expect(JSON.parse(options!.body as string).generationConfig.maxOutputTokens).toBe(16384);
        return new Response("sensitive provider response", { status: 403 });
      },
    });
    expect(reviewer.version).toBe("gemini-3.8-flash");
    const error = await reviewer.generate("review", {}).catch((error) => error);
    expect(error).toBeInstanceOf(ModelProviderUnavailableError);
    expect(error.httpStatus).toBe(403);
    expect(error.message).not.toContain("sensitive");
    expect(error.message).not.toContain("private-token");
  });
  it("does not attribute previous successful token usage to a rate-limited attempt", async () => {
    let calls = 0;
    const reviewer = createGeminiFactualReviewModel({
      projectId: "test-project",
      token: async () => "test-token",
      request: async () =>
        ++calls === 1
          ? new Response(
              JSON.stringify({
                candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }],
                usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 5 },
              }),
            )
          : new Response("{}", { status: 429 }),
    });
    await reviewer.generate("review", {});
    expect(reviewer.lastUsage?.cachedContentTokenCount).toBe(5);
    await expect(reviewer.generate("review", {})).rejects.toMatchObject({ httpStatus: 429 });
    expect(reviewer.lastUsage).toBeUndefined();
  });
  it.each(["MAX_TOKENS", "INVALID_JSON"])(
    "does not turn %s reviewer output into prose repair",
    async (mode) => {
      const reviewer = createGeminiFactualReviewModel({
        projectId: "test-project",
        token: async () => "private-token",
        request: async () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: mode === "MAX_TOKENS" ? "MAX_TOKENS" : "STOP",
                  content: { parts: [{ text: "incomplete JSON" }] },
                },
              ],
            }),
          ),
      });
      await expect(reviewer.generate("review", {})).rejects.toThrow(
        "GEMINI_REVIEW_OUTPUT_INCOMPLETE",
      );
      await expect(reviewer.generate("review", {})).rejects.toBeInstanceOf(
        ModelProviderUnavailableError,
      );
    },
  );
  it("uses standard ADC credentials and coalesces simultaneous token requests", async () => {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    expect(
      auth.fromJSON({
        type: "authorized_user",
        client_id: "test",
        client_secret: "test",
        refresh_token: "test",
      }).constructor.name,
    ).toBe("UserRefreshClient");
    expect(
      auth.fromJSON({
        type: "service_account",
        client_email: "test@example.iam.gserviceaccount.com",
        private_key: "fixture-not-used-for-signing",
      }).constructor.name,
    ).toBe("JWT");
    expect(
      auth.fromJSON({
        type: "external_account",
        audience:
          "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/test/providers/test",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        token_url: "https://sts.googleapis.com/v1/token",
        credential_source: { file: "fixture-not-read" },
      }).constructor.name,
    ).toBe("IdentityPoolClient");
    const getAccessToken = vi.fn(async () => "test-token");
    const token = adcTokenProvider({ getAccessToken });
    expect(await Promise.all([token(), token(), token()])).toEqual([
      "test-token",
      "test-token",
      "test-token",
    ]);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    await expect(
      adcTokenProvider({
        getAccessToken: async () => {
          throw new Error("private credential contents");
        },
      })(),
    ).rejects.toThrow("Google ADC authentication unavailable");
  });
  it.each(["evaluation", "composition"])(
    "stops %s without semantic repairs on provider failure",
    async (phase) => {
      let calls = 0;
      const error = new ModelProviderUnavailableError("Bedrock provider HTTP 403", 403);
      const model = {
        id: "provider-failure-test",
        version: phase,
        async generate() {
          calls++;
          throw error;
        },
      };
      await expect(
        phase === "evaluation"
          ? runStagedFrozenDecisionDetailed(frozen, model)
          : composeStagedDossier(frozen, staged, model, model),
      ).rejects.toBe(error);
      expect(calls).toBe(1);
    },
  );
  it("preserves verdict, viability, mapping and screening roles while adding narrative", () => {
    const result = bindStagedEditorial(frozen, staged, editorial);
    expect(result.evaluation.verdict).toBe("PASS");
    expect(result.evaluation.screeningViability).toBe("PLAUSIBLE");
    expect(result.evaluation.requirements[0]).toMatchObject({
      mandatory: false,
      decisionRole: "PREFERENCE",
      status: "DIRECT",
      candidateClaimIds: ["CANDIDATE-1-1"],
    });
    expect(staged.trace.requirements[0]).toMatchObject({
      id: "REQ-001",
      screeningFunction: "ROLE_PERFORMANCE_REQUIREMENT",
      screeningGateBasis: "NONE",
      screeningSupportQuoteIds: ["REQ-001:Q1"],
      mappingReasoning: "Direct growth precedent",
    });
  });
  it("rejects a persisted staged result whose headline and trace decision diverge", () => {
    expect(() =>
      parseCanonicalStagedDecisionResult({
        ...staged,
        decision: { ...staged.decision, verdict: "PURSUE" },
      }),
    ).toThrow("STAGED_EVALUATION_DECISION_TRACE_MISMATCH");
  });
  it("rejects a persisted screening gate that disagrees with deterministic derivation", () => {
    const invalid: any = structuredClone(staged);
    invalid.trace.requirements[0].screeningGate = true;
    expect(() => parseCanonicalStagedDecisionResult(invalid)).toThrow(
      "STAGED_EVALUATION_SCREENING_GATE_DERIVATION_MISMATCH",
    );
  });
  it("rejects omission of an unresolved application-derived screening driver", () => {
    const invalid: any = structuredClone(staged);
    const requirement = invalid.trace.requirements[0];
    requirement.strength = "REQUIRED";
    requirement.screeningGate = true;
    requirement.screeningFunction = "ENTRY_QUALIFICATION";
    requirement.screeningGateBasis = "PRIOR_RELEVANT_EXPERIENCE";
    requirement.status = "NOT_EVIDENCED";
    requirement.candidateClaimIds = [];
    requirement.unsupportedAspects = ["Growth capability"];
    expect(() => parseCanonicalStagedDecisionResult(invalid)).toThrow(
      "STAGED_EVALUATION_SCREENING_DRIVER_DERIVATION_MISMATCH",
    );
  });
  it("replays decision policy rather than trusting a structurally valid persisted verdict", () => {
    const invalid: any = structuredClone(staged);
    invalid.decision.screeningViability = "BLOCKED";
    invalid.trace.decision.screeningViability = "BLOCKED";
    // The invariant under test is rejection after deterministic policy replay.
    // Do not couple this regression to the ordering or wording of policy errors.
    expect(() => parseCanonicalStagedDecisionResult(invalid)).toThrow();
  });
  it("rejects an editorial attempt to author the verdict", () => {
    expect(() =>
      bindStagedEditorial(frozen, staged, { ...editorial, verdict: "PURSUE" }),
    ).toThrow();
  });
  it("rejects fabricated evidence IDs", () => {
    expect(() =>
      bindStagedEditorial(frozen, staged, {
        ...editorial,
        narrativePlan: { ...editorial.narrativePlan, claimIds: ["INVENTED"] },
      }),
    ).toThrow("EDITORIAL_CLAIM_PROVENANCE_INVALID");
  });
  it("writes and reviews the whole memo once while preserving canonical decisions", async () => {
    const writer = { id: "one-writer", version: "1", generate: vi.fn(async () => draft()) };
    const reviewer = {
      id: "one-review",
      version: "1",
      generate: vi.fn(async (_i: string, input: any) => accept(input)),
    };
    const result = await composeStagedDossier(frozen, stagedEvaluation, writer, reviewer);
    expect(writer.generate).toHaveBeenCalledTimes(1);
    expect(reviewer.generate).toHaveBeenCalledTimes(1);
    expect(result.canonicalDecisionTrace).toEqual(stagedEvaluation.trace);
    assertFactualReviewProvenance(result);
  });
  it("resumes an interrupted review without regenerating the complete memo", async () => {
    const db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    let fail = true;
    const writer = { id: "restart-writer", version: "1", generate: vi.fn(async () => draft()) };
    const reviewer = {
      id: "restart-review",
      version: "1",
      generate: vi.fn(async (_i: string, input: any) => {
        if (fail) throw new ModelProviderUnavailableError("HTTP 429", 429);
        return accept(input);
      }),
    };
    await expect(
      composeStagedDossier(
        frozen,
        stagedEvaluation,
        durableDossierModel(db, "scope", writer),
        durableDossierModel(db, "scope", reviewer),
      ),
    ).rejects.toThrow("HTTP 429");
    fail = false;
    vi.resetModules();
    const resumed = await import("../../src/dossier/staged-composition");
    const result = await resumed.composeStagedDossier(
      frozen,
      stagedEvaluation,
      durableDossierModel(db, "scope", writer),
      durableDossierModel(db, "scope", reviewer),
    );
    expect(writer.generate).toHaveBeenCalledTimes(1);
    expect(reviewer.generate).toHaveBeenCalledTimes(2);
    assertFactualReviewProvenance(result);
  });
  it("returns factual and material coverage defects together and reuses unchanged accepted sections", async () => {
    const accepted = new Map();
    let calls = 0;
    const reviewer = {
      id: "partial-review",
      version: "1",
      async generate(_i: string, input: any) {
        calls++;
        if (calls > 1) {
          expect(input.passages.every((p: any) => p.section === "candidateFit")).toBe(true);
          return accept(input);
        }
        const rejected = input.passages
          .filter((p: any) => p.section === "candidateFit")
          .map((p: any) => p.passageId);
        return {
          ...accept(input),
          checks: accept(input).checks.map((c: any) => ({
            ...c,
            supported: !rejected.includes(c.passageId),
          })),
          acceptedPassageIds: input.passages
            .filter((p: any) => !rejected.includes(p.passageId))
            .map((p: any) => p.passageId),
          coveredPointIds: ["conditions"],
          defects: [
            {
              kind: "FACTUAL",
              passageIds: rejected,
              pointIds: [],
              issue: "Restore the projected qualifier.",
            },
            {
              kind: "MATERIAL_OMISSION",
              passageIds: [],
              pointIds: ["fit"],
              issue: "Preserve the missing direct precedent.",
            },
          ],
        };
      },
    };
    await expect(
      reviewMemo(reviewer, frozen, stagedEvaluation, research(), draft().memo, accepted),
    ).rejects.toThrow(/FACTUAL.*projected.*MATERIAL_OMISSION.*direct precedent/);
    expect(accepted.size).toBe(5);
    expect(
      await reviewMemo(reviewer, frozen, stagedEvaluation, research(), draft().memo, accepted),
    ).toHaveLength(6);
  });
  it.each(["missing", "duplicate", "invented", "contradictory"])(
    "rejects %s reviewer identities without accepting a receipt",
    async (mode) => {
      const reviewer = {
        id: "bad-review-" + mode,
        version: "1",
        generate: vi.fn(async (_i: string, input: any) => {
          const r: any = accept(input);
          if (mode === "missing") r.acceptedPassageIds.pop();
          if (mode === "duplicate") r.acceptedPassageIds.push(r.acceptedPassageIds[0]);
          if (mode === "invented") r.acceptedPassageIds[0] = "invented";
          if (mode === "contradictory")
            r.defects = [
              { kind: "MATERIAL_OMISSION", passageIds: [], pointIds: ["fit"], issue: "Missing" },
            ];
          return r;
        }),
      };
      await expect(
        reviewMemo(reviewer, frozen, stagedEvaluation, research(), draft().memo),
      ).rejects.toThrow("EDITORIAL_FACT_REVIEW_INVALID");
      expect(reviewer.generate).toHaveBeenCalledTimes(3);
    },
  );
  it("includes all candidate facts for absence checks but omits unrelated company evidence", async () => {
    const expanded = {
      ...frozen,
      evidence: [
        ...frozen.evidence,
        ...Array.from({ length: 200 }, (_, i) => ({ ...frozen.evidence[0], id: `unused-${i}` })),
      ],
    };
    const reviewer = {
      id: "scoped-review",
      version: "1",
      async generate(_i: string, input: any) {
        expect(input.claims.map((c: any) => c.id)).toEqual(["JD-1-1"]);
        expect(input.sharedContext.candidateEvidence.map((c: any) => c.id)).toEqual([
          "CANDIDATE-1-1",
        ]);
        expect(input.fixedAction).toBe("PURSUE");
        return accept(input);
      },
    };
    await reviewMemo(reviewer, expanded, stagedEvaluation, research(), draft().memo);
  });
  it("binds the stable candidate packet to source contents independently of the job", () => {
    const first = memoInputPacket(frozen, stagedEvaluation).candidateEvidence;
    const second = memoInputPacket(
      { ...frozen, opportunity: { id: "other", company: "Other", title: "Other" } },
      stagedEvaluation,
    ).candidateEvidence;
    expect(second).toEqual(first);
    const changed = structuredClone(frozen);
    changed.sources[1].text += " Changed evidence.";
    expect(memoInputPacket(changed, stagedEvaluation).candidateEvidence.fingerprint).not.toBe(
      first.fingerprint,
    );
  });
  it("prevents question-label failures and internal identifiers in visible explanations", () => {
    const value: any = draft().memo;
    value.decisionConditions[0].question.state = "EXPLICIT";
    expect(() => compositionSchema.parse(value)).toThrow();
    const leaked = draft().memo;
    leaked.candidateFit[0].assessment.reasoning = "Based on REQ-001";
    expect(() => validateMemoCopy(leaked, research(), stagedEvaluation)).toThrow(
      "keep internal identifiers",
    );
  });
  it("enforces memo budgets without truncating the returned model prose", () => {
    const value = draft().memo;
    for (const passage of allPassages(value)) passage.text = Array(80).fill("word").join(" ");
    expect(() => validateMemoCopy(value, research(), stagedEvaluation)).toThrow("650");
    expect(value.executiveThesis.text.split(" ")).toHaveLength(80);
  });
  it("backs off consecutive capacity failures with one wire request per attempt", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 429 }));
    const reviewer = createGeminiFactualReviewModel({
      projectId: "backoff-project",
      token: async () => "secret",
      request,
    });
    const delays = [];
    for (let i = 0; i < 3; i++)
      delays.push(await reviewer.generate("review", {}).catch((e) => e.retryAfterMs));
    expect(request).toHaveBeenCalledTimes(3);
    expect(delays[0]).toBeGreaterThanOrEqual(30_000);
    expect(delays[0]).toBeLessThan(33_000);
    expect(delays[1]).toBeGreaterThanOrEqual(60_000);
    expect(delays[2]).toBeGreaterThanOrEqual(120_000);
  });
  it("preserves an accepted cached memo on a subsequent reviewer outage", async () => {
    const writer = {
      id: "cached-writer-outage",
      version: "1",
      generate: vi.fn(async () => draft()),
    };
    let fail = false;
    const reviewer = {
      id: "cached-review-outage",
      version: "1",
      generate: vi.fn(async (_i: string, input: any) => {
        if (fail) throw new ModelProviderUnavailableError("Unavailable", 429);
        return accept(input);
      }),
    };
    const db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    const cachedWriter = durableDossierModel(db, "outage-test", writer);
    await composeStagedDossier(frozen, stagedEvaluation, cachedWriter, reviewer);
    fail = true;
    await expect(
      composeStagedDossier(frozen, stagedEvaluation, cachedWriter, reviewer),
    ).rejects.toThrow("Unavailable");
    expect(writer.generate).toHaveBeenCalledTimes(1);
  });
  it("returns plan and copy defects together before paying for review", async () => {
    const invalid = draft();
    invalid.narrativePlan.memoPoints = invalid.narrativePlan.memoPoints!.filter(
      (p) => p.section !== "decisionConditions",
    );
    invalid.memo.executiveThesis.reasoning = "Derived from REQ-001";
    const writer = {
      id: "combined-defects",
      version: "1",
      async generate(_i: string, input: any) {
        if (input.repair) {
          expect(input.repair).toContain("MEMO_PLAN_DECISION_COVERAGE");
          expect(input.repair).toContain("keep internal identifiers");
        }
        return invalid;
      },
    };
    const reviewer = { id: "not-called", version: "1", generate: vi.fn() };
    await expect(composeStagedDossier(frozen, stagedEvaluation, writer, reviewer)).rejects.toThrow(
      "MEMO_PLAN_DECISION_COVERAGE",
    );
    expect(reviewer.generate).not.toHaveBeenCalled();
  });
  it("requires a source comparison for every passage before accepting review", async () => {
    const reviewer = {
      id: "missing-fact-check",
      version: "1",
      async generate(_i: string, input: any) {
        return { ...accept(input), checks: [] };
      },
    };
    await expect(
      reviewMemo(reviewer, frozen, stagedEvaluation, research(), draft().memo),
    ).rejects.toThrow("REVIEW_FACT_CHECK_COVERAGE_INCOMPLETE");
  });
  it("does not accept a passage whose factual check reports an overstatement", async () => {
    const reviewer = {
      id: "contradictory-fact-check",
      version: "1",
      async generate(_i: string, input: any) {
        const r = accept(input);
        r.checks[0].supported = false;
        return r;
      },
    };
    await expect(
      reviewMemo(reviewer, frozen, stagedEvaluation, research(), draft().memo),
    ).rejects.toThrow("REVIEW_FACT_CHECK_RESULT_CONTRADICTORY");
  });

  it("keeps a factual repair available after bounded formatting repairs", async () => {
    let writes = 0,
      reviews = 0;
    const writer = {
      id: "separate-repair-budgets",
      version: "1",
      async generate(_i: string, input: any) {
        writes++;
        const value = draft();
        if (writes <= 3) value.memo.executiveThesis.reasoning = "";
        if (writes === 5) {
          expect(input.repair).toContain("Incorrect factual premise");
          expect(input.repairSections).toEqual(["approach"]);
          value.memo.approach.opening.text =
            "I would like to discuss the growth outcomes and operating mandate.";
        }
        if (input.repairSections)
          return {
            memo: Object.fromEntries(
              input.repairSections.map((k: keyof typeof value.memo) => [k, value.memo[k]]),
            ),
          };
        return value;
      },
    };
    const reviewer = {
      id: "separate-review-budget",
      version: "1",
      async generate(_i: string, input: any) {
        reviews++;
        const result: any = accept(input);
        if (reviews === 1) {
          const id = input.passages.find((p: any) => p.section === "approach").passageId;
          result.acceptedPassageIds = result.acceptedPassageIds.filter((x: string) => x !== id);
          result.checks = result.checks.map((c: any) => ({ ...c, supported: c.passageId !== id }));
          result.defects = [
            { kind: "FACTUAL", passageIds: [id], pointIds: [], issue: "Incorrect factual premise" },
          ];
        }
        return result;
      },
    };
    const result = await composeStagedDossier(frozen, stagedEvaluation, writer, reviewer);
    expect(writes).toBe(5);
    expect(reviews).toBe(2);
    assertFactualReviewProvenance(result);
    expect(result.candidateFit).toEqual(seed.candidateFit);
    expect(result.mandate).toEqual(seed.mandate);
  });
  it("allows useful section variation while enforcing the overall memo cap", () => {
    const value = draft().memo;
    value.executiveThesis.text = Array(66).fill("word").join(" ");
    expect(validateMemoCopy(value, research(), stagedEvaluation).executiveThesis.text).toBe(
      value.executiveThesis.text,
    );
  });
  it("keeps writer checkpoints when the reviewer model configuration changes", async () => {
    const db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    const writer = { id: "stable-composer", version: "1", generate: vi.fn(async () => draft()) };
    const review = {
      id: "changing-reviewer",
      version: "1",
      configurationFingerprint: "first",
      generate: vi.fn(async () => ({ ok: true })),
    };
    await durableDossierModel(db, "same-evaluation-recipe", writer).generate("write", {});
    await durableDossierModel(db, "same-evaluation-recipe", review).generate("review", {});
    await durableDossierModel(db, "same-evaluation-recipe", {
      ...review,
      configurationFingerprint: "second",
    }).generate("review", {});
    await durableDossierModel(db, "same-evaluation-recipe", writer).generate("write", {});
    expect(writer.generate).toHaveBeenCalledTimes(1);
    expect(review.generate).toHaveBeenCalledTimes(2);
  });
  it.each(["\n", "\r\n"])(
    "carries source-authored career-scope clarifications with %j line endings verbatim to writer and reviewer",
    async (newline) => {
      const scoped = structuredClone(frozen);
      const note =
        "Total career tenure spans several sectors. No sector-specific duration is established.";
      scoped.sources[1].text = `# Candidate factual scope clarifications\n\n${note}\n\n# Candidate source\n\n${scoped.sources[1].text}`;
      scoped.sources[1].text = scoped.sources[1].text.replaceAll("\n", newline);
      const expected = [{ sourceId: "cv", quote: note }];
      expect(memoInputPacket(scoped, stagedEvaluation).candidateEvidence.clarifications).toEqual(
        expected,
      );
      const reviewer = {
        id: "clarified-source-review",
        version: "1",
        async generate(_i: string, input: any) {
          expect(input.sharedContext.candidateClarifications).toEqual(expected);
          return accept(input);
        },
      };
      await reviewMemo(reviewer, scoped, stagedEvaluation, research(), draft().memo);
      expect(memoInputPacket(frozen, stagedEvaluation).candidateEvidence.clarifications).toEqual(
        [],
      );
    },
  );
});
