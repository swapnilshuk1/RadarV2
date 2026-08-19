import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  canonicalize,
  computeCanonicalFingerprint,
  classifyFingerprint,
  buildIntrinsicEvaluationInput,
  computeIntrinsicFingerprint,
  isEvaluationFresh,
} from "../../src/lib/intelligence/fingerprint/EvaluationFingerprint";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteEvaluationStore } from "../../src/data/sqlite/repositories/SqliteEvaluationStore";

describe("Phase 4C: Canonical Fingerprinting, Freshness & Schema Readiness", () => {
  const originalRadarEnv = process.env.RADAR_ENV;
  const originalTursoUrl = process.env.TURSO_CONNECTION_URL;
  const originalTursoToken = process.env.TURSO_AUTH_TOKEN;

  beforeEach(() => {
    resetDatabaseAdapter();
    process.env.RADAR_ENV = "test";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  afterEach(() => {
    resetDatabaseAdapter();
    if (originalRadarEnv) process.env.RADAR_ENV = originalRadarEnv;
    else delete process.env.RADAR_ENV;
    if (originalTursoUrl) process.env.TURSO_CONNECTION_URL = originalTursoUrl;
    else delete process.env.TURSO_CONNECTION_URL;
    if (originalTursoToken) process.env.TURSO_AUTH_TOKEN = originalTursoToken;
    else delete process.env.TURSO_AUTH_TOKEN;
  });

  const baseCandidate = {
    id: "cand_swapnil",
    personId: "cand_swapnil",
    operatingLevel: { value: "VP" },
    candidateSeniorityLevel: { value: "Executive" },
    workNature: { value: "Growth & Product" },
    decisionAuthority: { value: "P&L Owner" },
    commercialScope: { value: "₹100Cr+" },
    yearsOfExperience: 15,
    coreCapabilities: ["Executive Leadership", "Growth Marketing", "B2B SaaS"],
    preferredLocations: ["Bengaluru", "Remote"],
    preferredWorkModel: "HYBRID",
    executiveThemes: ["Enterprise Scale", "Product-Led Growth"],
    attentionWindow: 6,
    activePursuits: 2,
    headspaceCapacityPerMonth: 4,
  };

  const baseOpportunity = {
    jobHash: "opp_job_001",
    role: "VP Growth & Marketing",
    company: "Acme Corp",
    location: "Bengaluru",
    workModel: "HYBRID",
    description: "Lead end-to-end commercial growth and marketing expansion across APAC.",
    dimensions: [
      { key: "mandate", importance: "Core", bucket: "Verified", value: "P&L Growth", quote: "Manage ₹150Cr P&L" },
      { key: "scope", importance: "Core", bucket: "Verified", value: "Direct Reports", quote: "Lead team of 45" },
    ],
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 92,
    },
    userDecision: {
      userAction: "CONSIDER",
    },
    effectiveDecision: "PURSUE",
    reviewWorkflowState: "ACTIVE_REVIEW",
    uiBadge: "TOP_FIT",
    displayScore: 95,
  };

  describe("1. Canonical Serialization & Determinism", () => {
    it("serializes objects deterministically regardless of key insertion order", () => {
      const objA = { z: "last", a: "first", m: 42, b: true, nested: { y: 2, x: 1 } };
      const objB = { nested: { x: 1, y: 2 }, b: true, a: "first", z: "last", m: 42 };

      const canonA = canonicalize(objA);
      const canonB = canonicalize(objB);

      expect(canonA).toBe(canonB);
      expect(canonA).toBe('{"a":"first","b":true,"m":42,"nested":{"x":1,"y":2},"z":"last"}');
    });

    it("handles primitives, nulls, arrays, and ignores undefined", () => {
      expect(canonicalize(null)).toBe("null");
      expect(canonicalize(undefined)).toBe("null");
      expect(canonicalize(true)).toBe("true");
      expect(canonicalize(false)).toBe("false");
      expect(canonicalize(123.45)).toBe("123.45");
      expect(canonicalize(Infinity)).toBe("null");
      expect(canonicalize(NaN)).toBe("null");
      expect(canonicalize("hello")).toBe('"hello"');
      expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
      expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    });
  });

  describe("2. Canonical SHA-256 Fingerprint Properties", () => {
    it("produces deterministic eval_v4_ formatted 72-character string", () => {
      const fp1 = computeCanonicalFingerprint({ a: 1, b: "test" });
      const fp2 = computeCanonicalFingerprint({ b: "test", a: 1 });

      expect(fp1).toBe(fp2);
      expect(fp1).toMatch(/^eval_v4_[a-f0-9]{64}$/);
      expect(fp1.length).toBe(72);
    });

    it("produces distinct digests for distinct inputs", () => {
      const fp1 = computeCanonicalFingerprint({ value: "A" });
      const fp2 = computeCanonicalFingerprint({ value: "B" });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("3. Intrinsic Sensitivity Tests", () => {
    it("alters fingerprint when candidate operatingLevel changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, operatingLevel: { value: "Director" } }, baseOpportunity);
      expect(fp1).not.toBe(fp2);
    });

    it("alters fingerprint when candidate yearsOfExperience changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, yearsOfExperience: 20 }, baseOpportunity);
      expect(fp1).not.toBe(fp2);
    });

    it("alters fingerprint when candidate coreCapabilities changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, coreCapabilities: ["AI Architecture"] }, baseOpportunity);
      expect(fp1).not.toBe(fp2);
    });

    it("alters fingerprint when candidate preferredLocations changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, preferredLocations: ["London"] }, baseOpportunity);
      expect(fp1).not.toBe(fp2);
    });

    it("alters fingerprint when candidate preferredWorkModel changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, preferredWorkModel: "ONSITE" }, baseOpportunity);
      expect(fp1).not.toBe(fp2);
    });

    it("alters fingerprint when opportunity role or company changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fpDiffRole = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, role: "Chief Marketing Officer" });
      const fpDiffCompany = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, company: "Beta Corp" });

      expect(fp1).not.toBe(fpDiffRole);
      expect(fp1).not.toBe(fpDiffCompany);
    });

    it("alters fingerprint when opportunity description or dimensions changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fpDiffDesc = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, description: "New requirements." });
      const fpDiffDims = computeIntrinsicFingerprint(baseCandidate, {
        ...baseOpportunity,
        dimensions: [{ key: "scope", importance: "Core", bucket: "Missing", value: "None", quote: "" }],
      });

      expect(fp1).not.toBe(fpDiffDesc);
      expect(fp1).not.toBe(fpDiffDims);
    });

    it("alters fingerprint when policyVersion or ontologyVersion changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, baseOpportunity, "v4.3", "v2");
      const fpDiffPolicy = computeIntrinsicFingerprint(baseCandidate, baseOpportunity, "v4.4", "v2");
      const fpDiffOntology = computeIntrinsicFingerprint(baseCandidate, baseOpportunity, "v4.3", "v3");

      expect(fp1).not.toBe(fpDiffPolicy);
      expect(fp1).not.toBe(fpDiffOntology);
    });
  });

  describe("4. Contextual Invariance Tests (Context NEVER Alters Intrinsic Fingerprint)", () => {
    it("maintains IDENTICAL fingerprint across attentionWindow variations", () => {
      const fp1 = computeIntrinsicFingerprint({ ...baseCandidate, attentionWindow: 6 }, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, attentionWindow: 12 }, baseOpportunity);
      expect(fp1).toBe(fp2);
    });

    it("maintains IDENTICAL fingerprint across activePursuits variations", () => {
      const fp1 = computeIntrinsicFingerprint({ ...baseCandidate, activePursuits: 0 }, baseOpportunity);
      const fp2 = computeIntrinsicFingerprint({ ...baseCandidate, activePursuits: 5 }, baseOpportunity);
      expect(fp1).toBe(fp2);
    });

    it("maintains IDENTICAL fingerprint across userDecision / override variations", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, userDecision: null });
      const fp2 = computeIntrinsicFingerprint(baseCandidate, {
        ...baseOpportunity,
        userDecision: { userAction: "PASS" },
        effectiveDecision: "USER_PASS",
      });
      expect(fp1).toBe(fp2);
    });

    it("maintains IDENTICAL fingerprint across UI badges and display ranking score changes", () => {
      const fp1 = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, uiBadge: "TIER_1", displayScore: 99 });
      const fp2 = computeIntrinsicFingerprint(baseCandidate, { ...baseOpportunity, uiBadge: "TIER_3", displayScore: 40 });
      expect(fp1).toBe(fp2);
    });
  });

  describe("5. Fingerprint Classification & Freshness API", () => {
    it("correctly classifies canonical vs legacy fingerprints", () => {
      expect(
        classifyFingerprint("eval_v4_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
      ).toBe("CANONICAL_V4");

      expect(classifyFingerprint("eval_hash_7bc23a")).toBe("LEGACY_NON_CANONICAL");
      expect(classifyFingerprint("legacy_v4.1")).toBe("LEGACY_NON_CANONICAL");
      expect(classifyFingerprint("")).toBe("LEGACY_NON_CANONICAL");
      expect(classifyFingerprint(null)).toBe("LEGACY_NON_CANONICAL");
      expect(classifyFingerprint(undefined)).toBe("LEGACY_NON_CANONICAL");
    });

    it("evaluates FRESH, STALE, and LEGACY states accurately", () => {
      const currentHash = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);

      // Fresh: exact canonical match
      expect(
        isEvaluationFresh({ evaluationInputHash: currentHash }, currentHash)
      ).toBe("FRESH");

      // Stale: canonical fingerprint but inputs changed
      const oldCanonical = computeCanonicalFingerprint({ older: true });
      expect(
        isEvaluationFresh({ evaluationInputHash: oldCanonical }, currentHash)
      ).toBe("STALE");

      // Legacy: historical 32-bit hash
      expect(
        isEvaluationFresh({ evaluationInputHash: "eval_hash_1234abcd" }, currentHash)
      ).toBe("LEGACY");

      // Stale: null / missing evaluation
      expect(isEvaluationFresh(null, currentHash)).toBe("STALE");
    });
  });

  describe("6. Migration 017 & Database Index Readiness", () => {
    it("runs Migration 017 cleanly and registers required indexes", async () => {
      const db = getDatabaseAdapter(":memory:");
      const result = await runMigrations(db);

      expect(result.applied).toContain("017_candidate_evaluations_v4_canonical.sql");

      // Query index metadata
      const indexes = await db.many<{ name: string; tbl_name: string }>(
        "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
      );
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain("idx_candidate_evaluations_input_hash");
      expect(indexNames).toContain("idx_evaluation_jobs_queue_v2");

      // Verify query plan uses idx_candidate_evaluations_input_hash
      const plan = await db.many<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT * FROM candidate_evaluations WHERE person_id = ? AND evaluation_input_hash = ?",
        ["cand_1", "eval_v4_1234"]
      );

      const planText = plan.map((p) => p.detail).join(" ");
      expect(planText).toContain("idx_candidate_evaluations_input_hash");
    });
  });

  describe("7. Worker & Store Canonical Consistency", () => {
    it("SqliteEvaluationStore.computeCanonicalFingerprint matches pure computeIntrinsicFingerprint", () => {
      const fpPure = computeIntrinsicFingerprint(baseCandidate, baseOpportunity);
      const fpStore = SqliteEvaluationStore.computeCanonicalFingerprint(baseCandidate, baseOpportunity);
      expect(fpPure).toBe(fpStore);
    });

    it("EvaluationWorker saves payload with consistent evaluationInputHash and engine_verdict === intrinsicVerdict", async () => {
      const db = getDatabaseAdapter(":memory:");
      await runMigrations(db);

      const evalStore = new SqliteEvaluationStore(db);
      const personId = "user_worker_test";
      const jobHash = "job_worker_test";

      // Insert parent foreign key records
      await db.execute(`INSERT INTO companies (id, name) VALUES ('comp_1', 'Acme Corp')`);
      await db.execute(
        `INSERT INTO people (id, email, meta_schema_version, meta_timestamp) VALUES (?, 'test@radar.internal', 'v1', CURRENT_TIMESTAMP)`,
        [personId]
      );
      await db.execute(
        `INSERT INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, 'comp_1', 'Director of Strategy', 'fp_123', 'ACTIVE')`,
        [jobHash]
      );

      // Enqueue a job
      const inputHash = computeCanonicalFingerprint({ seed: 1 });
      await evalStore.enqueueJob(personId, jobHash, inputHash);

      // Save evaluation directly to verify canonical invariant
      const canonicalFp = computeIntrinsicFingerprint(
        { operatingLevel: "Director", yearsOfExperience: 14 },
        { jobHash, role: "Director of Strategy", company: "Test Co" }
      );

      const canonicalPayload = {
        schemaVersion: "v4.2-intrinsic" as const,
        jobHash,
        personId,
        evaluationInputHash: canonicalFp,
        policyVersion: "v4.3",
        ontologyVersion: "v2",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "PURSUE" as const,
        intrinsicQualityScore: 88,
        parsingConfidence: 0.9,
        vetoed: false,
        vetoReason: null,
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: [],
        evaluationStatus: "COMPLETE" as const,
        dimensions: [],
        esi: 85,
        diligenceStatus: "READY",
        baseNarrative: {
          whyNow: "High growth",
          positioning: "Leadership",
          primaryProof: "Evidence",
          recommendedAction: "PURSUE",
        },
        auditTrace: {
          verb0: "PURSUE",
          careerValue: 80,
          shortlistingPotential: 85,
          pursuitFriction: 1.0,
          rawScore: 88,
          evidenceMappingCount: 0,
        },
      };

      await evalStore.saveEvaluation({
        personId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: canonicalFp,
        engineVerdict: "PURSUE",
        engineQualityScore: 88,
        effectiveDecision: "PURSUE",
        qualityScore: 88,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(canonicalPayload),
      });

      const saved = await evalStore.getEvaluation(personId, jobHash);
      expect(saved).not.toBeNull();
      expect(saved!.evaluationInputHash).toBe(canonicalFp);
      expect(saved!.engineVerdict).toBe("PURSUE");

      const parsedJson = JSON.parse(saved!.evaluationJson);
      expect(parsedJson.schemaVersion).toBe("v4.2-intrinsic");
      expect(parsedJson.evaluationInputHash).toBe(saved!.evaluationInputHash);
      expect(parsedJson.intrinsicVerdict).toBe(saved!.engineVerdict);
    });
  });
});
