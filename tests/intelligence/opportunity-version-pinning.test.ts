import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import {
  buildCanonicalEvaluatedPayload,
  buildCanonicalUnavailablePayload,
} from "@/lib/intelligence/evaluation/PayloadMapper";
import {
  buildEvaluatedPresentationV2,
  buildUnavailablePresentationV2,
} from "@/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer";
import {
  isCanonicalDossierPresentationV2,
  CanonicalDossierPresentationV2,
} from "@/lib/domain/dossier_presentation";
import { SqliteDossierPresentationStore } from "@/data/sqlite/repositories/SqliteDossierPresentationStore";
import { buildEditorialIntelligenceContract } from "@/lib/intelligence/editorial/EditorialIntelligenceContractBuilder";
import { composeEditorialIntelligenceV2 } from "@/lib/intelligence/editorial/EditorialPropositionComposer";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { computeEvaluationIdentity } from "@/lib/domain/evaluation_fingerprint";

class MemorySqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

const mockCandidate: CandidateProjection = {
  version: "1.0.0",
  id: "cand-1",
  tenantId: "tenant-test",
  personId: "person-test",
  name: "Jane Executive",
  email: "jane@example.com",
  targetRoles: ["VP of Product", "Chief Product Officer"],
  capabilities: [
    {
      name: "Product Strategy",
      level: "Executive",
      tier: "PRIMARY",
      depth: 5,
      evidence: ["Led 0 to 1 enterprise product"],
    },
  ],
  inferredCapabilities: [
    {
      name: "Product Strategy",
      confidence: 0.92,
      supportingEvidence: [{ quote: "Led enterprise product from 0 to 1" }],
      evidenceIds: ["cand-1"],
    },
  ],
  domains: ["Enterprise SaaS", "AI"],
  seniorityLevel: "VP",
  preferredLocations: ["Remote", "Bengaluru"],
  workHistory: [
    {
      company: "Tech Corp",
      title: "VP Product",
      duration: "4 years",
      scope: "Global teams",
      highlights: ["Scaled ARR to $50M"],
    },
  ],
  narrativeTrajectory: "Executive product leader driving scale.",
};

const mockArtifact: EvaluationArtifact = {
  score: 88,
  decision: "PURSUE",
  evaluationInputHash: "eval-hash-pinned",
  evaluationContextFingerprint: "ctx-fp-pinned",
  evaluatedAt: "2026-09-10T12:00:00Z",
  record: {
    verb: "PURSUE",
    qualityScore: 88,
    jobHash: "job-hash-123",
    diligenceStatus: "READY",
  },
  opportunity: {
    jobHash: "job-hash-123",
    title: "VP of Product",
    company: "Acme Corp",
    decision: "PURSUE",
    score: 88,
  },
  jobProjection: {
    roleWorkEvidence: [
      {
        id: "work-1",
        kind: "OUTCOME",
        statement: "Scale B2B product to $100M ARR",
        sourceQuote: "Scale B2B product to $100M ARR",
        sourceRegion: "RESPONSIBILITIES",
        ordinal: 1,
        confidence: 0.95,
      },
    ],
    qualifications: [
      {
        id: "qual-1",
        name: "Enterprise SaaS",
        confidence: 0.95,
        type: "CORE QUALIFICATION",
        tier: "CORE QUALIFICATION",
        sourceSnippet: "10+ years in Enterprise SaaS",
        sourceSection: "Requirements",
      },
    ],
  },
  decisionTrace: {
    version: "canonical-decision-trace/v1",
    relationships: [
      {
        evaluatorTraceId: "trace-rel-1",
        jobEvidenceIds: ["work-1"],
        candidateEvidenceIds: ["cand-1"],
        candidateCapabilityKey: "Product Strategy",
        jobCapabilityKey: "Product Leadership",
        relationship: "MATCH",
      },
    ],
    components: [],
  },
} as unknown as EvaluationArtifact;

describe("Phase 4: Opportunity Version Pinning & Presentation Architecture", () => {
  let db: Database.Database;
  let adapter: MemorySqliteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    const migrations = [
      "001_initial_schema.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "021_evaluation_work_queue.sql",
      "025_canonical_decisions.sql",
      "044_materialized_dossier_presentations.sql",
    ];

    for (const mig of migrations) {
      const sql = fs.readFileSync(
        path.join(process.cwd(), "src/data/sqlite/migrations", mig),
        "utf-8",
      );
      db.exec(sql);
    }

    adapter = new MemorySqliteAdapter(db);
  });

  describe("A. Producer Pinning Verification", () => {
    it("pins exact canonicalJobId and opportunityVersion in evaluation payload", () => {
      const payload = buildCanonicalEvaluatedPayload(
        mockArtifact,
        {
          contextFingerprint: "ctx-123",
          tenantId: "tenant-a",
          personId: "person-a",
          policyVersion: "v1.0",
          ontologyVersion: "v1.0",
          ontologyFingerprint: "onto-1",
          profileVersion: "v1.0",
          searchPlanId: "sp-1",
        },
        "canonical-job-456",
        "opp-ver-789",
        "2026-09-10T12:00:00Z",
        mockCandidate,
      );

      expect(payload.canonicalJobId).toBe("canonical-job-456");
      expect(payload.opportunityVersion).toBe("opp-ver-789");
      expect(payload.jobHash).toBe("job-hash-123");
      // V1 presentation must NOT be attached to newly built payloads
      expect((payload as Record<string, unknown>).dossierPresentation).toBeUndefined();
    });

    it("pins exact canonicalJobId and opportunityVersion in V2 presentation", () => {
      const identity = {
        tenantId: "tenant-a",
        personId: "person-a",
        canonicalJobId: "canonical-job-456",
        opportunityVersion: "opp-ver-789",
        evaluationContextFingerprint: "ctx-123",
      };

      const presentation = buildEvaluatedPresentationV2({
        identity,
        artifact: mockArtifact,
        candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey,
      });

      expect(presentation.identity.canonicalJobId).toBe("canonical-job-456");
      expect(presentation.identity.opportunityVersion).toBe("opp-ver-789");
      expect(presentation.evaluation.fingerprint).toBe(computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey);
      expect(isCanonicalDossierPresentationV2(presentation)).toBe(true);
    });

    it("asserts decisionTrace.relationships[].jobEvidenceIds[] resolve against persisted projection", () => {
      const jobEvidenceIds = mockArtifact.jobProjection?.roleWorkEvidence?.map((e: { id: string }) => e.id) || [];
      const relationships = (mockArtifact.decisionTrace as { relationships: Array<{ jobEvidenceIds: string[] }> }).relationships;

      for (const rel of relationships) {
        for (const evidenceId of rel.jobEvidenceIds) {
          expect(jobEvidenceIds).toContain(evidenceId);
        }
      }
    });
  });

  describe("B. The 5 Explicit Regressions", () => {
    it("Regression 1: legacy:mapping:* + retained old decisionDrivers MUST NEVER produce 'stored evaluator trace links...'", () => {
      const legacyContract = buildEditorialIntelligenceContract({
        state: "EVALUATED",
        artifact: {
          ...mockArtifact,
          decisionTrace: {
            version: "canonical-decision-trace/v1",
            relationships: [
              {
                evaluatorTraceId: "legacy:mapping:cpo_strategy",
                jobEvidenceIds: ["legacy:mapping:work_item"],
                candidateEvidenceIds: ["cand-1"],
                relationship: "MATCH",
              },
            ],
            components: [],
          },
        } as unknown as EvaluationArtifact,
        candidateProjection: mockCandidate,
      });

      const composition = composeEditorialIntelligenceV2(legacyContract);
      const allProse = JSON.stringify(composition);

      expect(allProse).not.toContain("stored evaluator trace links");
      expect(allProse).not.toContain("legacy:mapping");
    });

    it("Regression 2: Persisted trace relationship + NO retained driver components MAY produce trace-backed fit explanation", () => {
      const contract = buildEditorialIntelligenceContract({
        state: "EVALUATED",
        artifact: mockArtifact,
        candidateProjection: mockCandidate,
      });

      const composition = composeEditorialIntelligenceV2(contract);
      const fitProp = composition.propositions.find(
        (p) => p.text.includes("stored evaluator trace links"),
      );

      expect(fitProp).toBeDefined();
      expect(fitProp?.roleEvidenceIds).toContain("work-1");
      expect(fitProp?.text).toContain("stored evaluator trace links");
    });

    it("Regression 3: SPARSE_SPEC / NOT_EVALUABLE with valid source-only dossier-v2 returns V2 presentation", () => {
      const identity = {
        tenantId: "tenant-a",
        personId: "person-a",
        canonicalJobId: "job-sparse-1",
        opportunityVersion: "ver-sparse-1",
        evaluationContextFingerprint: "ctx-1",
      };

      const unavailablePres = buildUnavailablePresentationV2({
        identity,
        reasonCode: "SPARSE_SPEC",
        presentationEvidence: {
          roleWorkEvidence: [
            {
              id: "ev-1",
              kind: "RESPONSIBILITY",
              statement: "Define engineering roadmap and technical architecture",
              sourceQuote: "Define engineering roadmap and technical architecture",
              sourceRegion: "RESPONSIBILITIES",
              ordinal: 1,
              confidence: 0.95,
            },
          ],
          presentationQualificationEvidence: [],
        },
      });

      expect(isCanonicalDossierPresentationV2(unavailablePres)).toBe(true);
      expect(unavailablePres.evaluation.state).toBe("SPARSE_SPEC");
      expect(unavailablePres.evaluation.fingerprint).toBeNull();
      expect(unavailablePres.composition.sections.hero.propositions[0]?.text).toContain("Define engineering roadmap");
    });

    it("Regression 4: Source-only presentation (null fingerprint) overwritten by later evaluated presentation under same identity", async () => {
      const store = new SqliteDossierPresentationStore(adapter);
      const identity = {
        tenantId: "tenant-a",
        personId: "person-a",
        canonicalJobId: "job-lifecycle-1",
        opportunityVersion: "ver-1",
        evaluationContextFingerprint: "ctx-lifecycle",
      };

      // 1. Initial source-only presentation with null fingerprint
      const sourceOnlyPres = buildUnavailablePresentationV2({
        identity,
        reasonCode: "NOT_EVALUABLE",
        presentationEvidence: {
          roleWorkEvidence: [
            {
              id: "ev-1",
              kind: "RESPONSIBILITY",
              statement: "Initial Scout requirement for VP Engineering",
              sourceQuote: "Initial Scout requirement for VP Engineering",
              sourceRegion: "RESPONSIBILITIES",
              ordinal: 1,
              confidence: 0.9,
            },
          ],
          presentationQualificationEvidence: [],
        },
      });

      await store.savePresentation(sourceOnlyPres, null);

      // Verify source-only presentation is readable when fingerprint is null
      const fetchedInitial = await store.getPresentation(identity, null);
      expect(fetchedInitial).not.toBeNull();
      expect(fetchedInitial?.evaluation.state).toBe("NOT_EVALUABLE");
      expect(fetchedInitial?.evaluation.fingerprint).toBeNull();

      // 2. Later evaluated presentation overwrites the row under same identity
      const evaluatedPres = buildEvaluatedPresentationV2({
        identity,
        artifact: mockArtifact,
        candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey,
      });

      const completedFingerprint = computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey;
      await store.savePresentation(evaluatedPres, completedFingerprint);

      // Verify evaluated presentation is returned for the evaluation fingerprint
      const fetchedEvaluated = await store.getPresentation(identity, completedFingerprint);
      expect(fetchedEvaluated).not.toBeNull();
      expect(fetchedEvaluated?.evaluation.state).toBe("EVALUATED");
      expect(fetchedEvaluated?.evaluation.fingerprint).toBe(completedFingerprint);

      // Stale null query MUST now return null because fingerprint is no longer null!
      const fetchedStaleNull = await store.getPresentation(identity, null);
      expect(fetchedStaleNull).toBeNull();
    });

    it("Regression 4b: exact tenant, person, version, context, and fingerprint prevent cross-serving a dossier", async () => {
      const store = new SqliteDossierPresentationStore(adapter);
      const identity = {
        tenantId: "tenant-a",
        personId: "person-a",
        canonicalJobId: "shared-job",
        opportunityVersion: "version-a",
        evaluationContextFingerprint: "context-a",
      };
      const presentation = buildEvaluatedPresentationV2({
        identity,
        artifact: mockArtifact,
        candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey,
      });
      const evaluationFingerprint = computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey;
      await store.savePresentation(presentation, evaluationFingerprint);

      expect(await store.getPresentation(identity, evaluationFingerprint)).not.toBeNull();
      expect(await store.getPresentation({ ...identity, personId: "person-b" }, evaluationFingerprint)).toBeNull();
      expect(await store.getPresentation({ ...identity, opportunityVersion: "version-b" }, evaluationFingerprint)).toBeNull();
      expect(await store.getPresentation({ ...identity, evaluationContextFingerprint: "context-b" }, evaluationFingerprint)).toBeNull();
      expect(await store.getPresentation(identity, "evaluation-b")).toBeNull();
    });

    it("refuses persistence when the storage fingerprint differs from the embedded V2 fingerprint", async () => {
      const store = new SqliteDossierPresentationStore(adapter);
      const identity = {
        tenantId: "tenant-a", personId: "person-a", canonicalJobId: "job-fingerprint",
        opportunityVersion: "version-a", evaluationContextFingerprint: "context-a",
      };
      const presentation = buildEvaluatedPresentationV2({
        identity, artifact: mockArtifact, candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity(identity.canonicalJobId, identity.opportunityVersion, identity.evaluationContextFingerprint).idempotencyKey,
      });
      await expect(store.savePresentation(presentation, "different-fingerprint"))
        .rejects.toThrow(/must exactly match/i);
    });

    it("requires non-null evaluation scalars for EVALUATED dossier-v2", () => {
      const presentation = buildEvaluatedPresentationV2({
        identity: {
          tenantId: "tenant-a",
          personId: "person-a",
          canonicalJobId: "job-a",
          opportunityVersion: "version-a",
          evaluationContextFingerprint: "context-a",
        },
        artifact: mockArtifact,
        candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity("job-a", "version-a", "context-a").idempotencyKey,
      });
      expect(isCanonicalDossierPresentationV2({
        ...presentation,
        evaluation: { ...presentation.evaluation, score: null },
      })).toBe(false);
    });

    it("rejects evaluated V2 materialization when canonical record scalars are not finite in range", () => {
      expect(() => buildEvaluatedPresentationV2({
        identity: {
          tenantId: "tenant-a", personId: "person-a", canonicalJobId: "job-a",
          opportunityVersion: "version-a", evaluationContextFingerprint: "ctx-a",
        },
        artifact: {
          ...mockArtifact,
          record: { ...mockArtifact.record, qualityScore: Number.POSITIVE_INFINITY },
        } as EvaluationArtifact,
        candidateProjection: mockCandidate,
        evaluationFingerprint: computeEvaluationIdentity("job-a", "version-a", "ctx-a").idempotencyKey,
      })).toThrow(/EVALUATED artifact|finite 0–100 score/i);
    });

    it("rejects unavailable V2 materialization for an unsafe unavailable state", () => {
      expect(() => buildUnavailablePresentationV2({
        identity: {
          tenantId: "tenant-a", personId: "person-a", canonicalJobId: "job-a",
          opportunityVersion: "version-a", evaluationContextFingerprint: "ctx-a",
        },
        reasonCode: "PROFILE_REQUIRED",
      })).toThrow(/only supports SPARSE_SPEC or NOT_EVALUABLE/i);
    });

    it("Regression 5: Source-level AST/regex boundary verifies producers and UI no longer import or invoke V1 dossier components", () => {
      const filesToCheck = [
        "src/lib/intelligence/EvaluationWorker.ts",
        "src/lib/intelligence/context-materialization.ts",
        "src/routes/opportunity.$jobHash.tsx",
      ];

      const forbiddenSymbols = [
        "buildCanonicalDossierPresentation",
        "BriefCompositionEngine",
        "ExecutionEngine",
        "AdvisoryConstitution",
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.resolve(process.cwd(), relPath);
        const content = fs.readFileSync(fullPath, "utf-8");

        for (const forbidden of forbiddenSymbols) {
          expect(
            content.includes(forbidden),
            `File ${relPath} must not import or reference ${forbidden}`,
          ).toBe(false);
        }
      }
    });
  });
});
