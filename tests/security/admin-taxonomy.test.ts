import { hostname } from "node:os";
import {
  baselineIntelligenceTaxonomy,
  validateIntelligenceTaxonomy,
  matchIntelligence,
} from "../../src/lib/ontology/intelligence-taxonomy";
import {
  pinIntelligence,
  readPinnedIntelligence,
} from "../../src/evaluation/intelligence-taxonomy";
import { evaluateAttentionGate } from "../../src/lib/intelligence/AttentionGate";
import {
  IntelligenceShadowWorker,
  assessIntelligenceShadow,
  type IntelligenceShadowResult,
} from "../../src/admin/intelligence-shadow-worker";
import {
  INTELLIGENCE_SHADOW_VERSION,
  intelligenceShadowCases,
} from "../../src/admin/intelligence-shadow";
import { benchFixtures } from "../../src/admin/bench-fixtures";
import {
  contextInputFingerprint,
  validateSnapshot,
} from "../../src/data/sqlite/repositories/SqliteStagedInputStore";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import {
  activateLineageTestContext,
  setupLineageTestFixture,
} from "../persistence/lineage_fixture";
import {
  activeSearchTaxonomy,
  mutateTaxonomy as rawMutateTaxonomy,
  readTaxonomySnapshot,
} from "../../src/admin/taxonomy-store";
import { ScraperPlanResolver } from "../../src/acquisition/plan-resolver";
import { SearchPlanner } from "../../scripts/scraper/run/search-planner";

const cleanup: SqliteAdapter[] = [];
function safeFixtureResult(cases: { id: string }[]): IntelligenceShadowResult {
  return {
    version: INTELLIGENCE_SHADOW_VERSION,
    safeToPublish: true,
    cases: cases.map(({ id }) => ({
      id,
      beforeAdmission: "CANDIDATE:REVIEW",
      afterAdmission: "CANDIDATE:REVIEW",
      beforeVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
      afterVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
      beforeViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
      afterViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
    })),
    admissionsChanged: 0,
    verdictsChanged: 0,
    passToPursue: 0,
    invalidOutputs: 0,
    repairs: 0,
  };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of cleanup.splice(0)) await db.close();
});

async function fixture() {
  vi.stubEnv("RADAR_ADMIN_BENCH_TARGET", "taxonomy-fixture");
  vi.stubEnv("RADAR_RELEASE_SHA", "b".repeat(40));
  vi.stubEnv("RADAR_ADMIN_BENCH_HOSTS", hostname());
  const db = new SqliteAdapter(new Database(":memory:"));
  cleanup.push(db);
  await setupLineageTestFixture(db);
  await db.execute(
    "INSERT INTO users(id,email) VALUES('op','op@fixture'),('viewer','viewer@fixture')",
  );
  await db.execute(
    "INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL),('viewer','viewer',0,'fixture','fixture',NULL)",
  );
  return db;
}

async function mutate(
  db: SqliteAdapter,
  input: Parameters<typeof rawMutateTaxonomy>[2] extends infer T
    ? T extends unknown
      ? Omit<T, "expectedState"> & { expectedState?: string }
      : never
    : never,
  actor = "op",
) {
  const snapshot = await readTaxonomySnapshot(db, "op");
  return rawMutateTaxonomy(db, actor, {
    ...input,
    expectedState: input.expectedState ?? snapshot.state,
  } as Parameters<typeof rawMutateTaxonomy>[2]);
}

describe("Phase 4 discovery taxonomy", () => {
  it("requires comparison when a display edit first enables the intelligence graph", async () => {
    const db = await fixture();
    const node = baselineIntelligenceTaxonomy.nodes.find((n) => n.id === "perf_mkt")!;
    const draft = await mutate(db, {
      kind: "intelligence_edit",
      nodeId: node.id,
      name: node.name,
      aliases: node.aliases,
      description: "Display description",
      reason: "first graph activation",
    });
    expect((await readTaxonomySnapshot(db, "op")).draft?.requires_shadow).toBe(1);
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: draft.id,
        confirmation: "PUBLISH",
        reason: "activation must be tested",
      }),
    ).rejects.toThrow("INTELLIGENCE_SHADOW_REQUIRED");
  });
  it("rejects ambiguous new intelligence aliases while preserving existing baseline mappings", () => {
    const graph = structuredClone(baselineIntelligenceTaxonomy);
    const nodes = graph.nodes.filter((n) => n.kind === "capability");
    nodes[0].aliases.push(nodes[1].name);
    expect(() => validateIntelligenceTaxonomy(graph)).toThrow("INTELLIGENCE_DUPLICATE_ALIAS");
    expect(() => validateIntelligenceTaxonomy(baselineIntelligenceTaxonomy)).not.toThrow();
  });
  it("stops a shadow at its reservation ceiling before provider dispatch", async () => {
    const db = await fixture();
    const draft = await mutate(db, {
      kind: "intelligence_classify",
      nodeId: "perf_mkt",
      classification: "ADJACENT",
      reason: "bounded model proof",
    });
    const queued = await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000,
      limit: 3,
      reason: "deliberately insufficient budget",
    });
    expect(await new IntelligenceShadowWorker(db).pollOnce()).toMatchObject({
      id: queued.id,
      status: "failed",
    });
    expect(
      await db.one("SELECT error,tokens_reserved FROM intelligence_taxonomy_shadows WHERE id=?", [
        queued.id,
      ]),
    ).toMatchObject({ error: "BENCH_TOKEN_CAP_OR_LEASE_LOST", tokens_reserved: 0 });
    expect(
      await db.one("SELECT COUNT(*) n FROM model_invocations WHERE taxonomy_shadow_run_id=?", [
        queued.id,
      ]),
    ).toMatchObject({ n: 0 });
  });
  it("records a bounded provider failure without exposing provider detail", async () => {
    const db = await fixture();
    const draft = await mutate(db, {
      kind: "intelligence_classify",
      nodeId: "perf_mkt",
      classification: "ADJACENT",
      reason: "provider classification",
    });
    const queued = await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000000,
      limit: 3,
      reason: "provider failure proof",
    });
    await db.execute(
      "INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,status,purpose,taxonomy_shadow_run_id,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        "provider-failure",
        "tenant_A",
        "person_A",
        "fixture",
        "fixture",
        "fixture",
        "evaluation",
        "role-interpretation",
        1,
        "bedrock",
        "fixture",
        "fixture",
        "fixture",
        "fixture",
        Date.now(),
        "transport_error",
        "BENCH",
        queued.id,
        "BENCH_PROVIDER_FAILURE",
      ],
    );
    expect(
      await new IntelligenceShadowWorker(db, async () => {
        throw new Error("upstream detail must not be persisted");
      }).pollOnce(),
    ).toMatchObject({ status: "failed" });
    expect(
      await db.one("SELECT error FROM intelligence_taxonomy_shadows WHERE id=?", [queued.id]),
    ).toMatchObject({ error: "BENCH_PROVIDER_FAILURE; retry creates a new bounded comparison" });
  });
  it("rejects a completed result when the deployment changes during its run", async () => {
    const db = await fixture();
    const draft = await mutate(db, {
      kind: "intelligence_classify",
      nodeId: "perf_mkt",
      classification: "CONTEXT",
      reason: "environment proof",
    });
    const queued = await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000000,
      limit: 3,
      reason: "environment drift",
    });
    const worker = new IntelligenceShadowWorker(db, async (_row, cases) => {
      vi.stubEnv("RADAR_RELEASE_SHA", "c".repeat(40));
      return safeFixtureResult(cases);
    });
    expect(await worker.pollOnce()).toMatchObject({ id: queued.id, status: "failed" });
    expect(
      await db.one("SELECT error FROM intelligence_taxonomy_shadows WHERE id=?", [queued.id]),
    ).toMatchObject({ error: "BENCH_RELEASE_OR_ENVIRONMENT_CHANGED" });
  });
  it("requires both proofs for combined intelligence and discovery structural changes", async () => {
    const db = await fixture();
    await mutate(db, {
      kind: "intelligence_classify",
      nodeId: "perf_mkt",
      classification: "ADJACENT",
      reason: "combined intelligence edit",
    });
    const draft = await mutate(db, {
      kind: "retire_concept",
      dimension: "targetRoles",
      concept: "VP Marketing",
      reason: "combined discovery edit",
    });
    await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000000,
      limit: 3,
      reason: "comparison proof",
    });
    expect(
      await new IntelligenceShadowWorker(db, async (_row, cases) =>
        safeFixtureResult(cases),
      ).pollOnce(),
    ).toMatchObject({ status: "passed" });
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: draft.id,
        confirmation: "PUBLISH",
        reason: "cannot omit discovery proof",
      }),
    ).rejects.toThrow("TAXONOMY_SHADOW_REQUIRED");
  });
  it("denies taxonomy reads and writes to users without a platform role", async () => {
    const db = await fixture();
    await expect(readTaxonomySnapshot(db, "viewer")).resolves.toMatchObject({ role: "viewer" });
    await expect(readTaxonomySnapshot(db, "person_A")).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    await expect(
      mutate(
        db,
        {
          kind: "draft_concept",
          dimension: "targetRoles",
          concept: "VP Marketing",
          description: "Marketing leadership",
          phrases: ["VP Marketing"],
          reason: "test write authorization",
        },
        "viewer",
      ),
    ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  });

  it("publishes a revisioned alias edit while retaining immutable history", async () => {
    const db = await fixture();
    const before = await readTaxonomySnapshot(db, "op");
    const draft = await mutate(db, {
      kind: "draft_concept",
      dimension: "targetRoles",
      concept: "VP Marketing",
      description: "Executive marketing leadership.",
      phrases: ["VP Marketing", "Vice President Marketing", "Marketing VP"],
      reason: "add a common portal designation",
    });
    expect((await activeSearchTaxonomy(db)).id).toBe(before.active.id);
    await expect(
      db.execute("UPDATE taxonomy_revisions SET definition_json='{}' WHERE id=?", [draft.id]),
    ).rejects.toThrow("TAXONOMY_REVISION_IMMUTABLE");
    await mutate(db, {
      kind: "publish",
      revisionId: draft.id,
      reason: "publish reviewed discovery wording",
    });
    const active = await activeSearchTaxonomy(db);
    expect(active.id).toBe(draft.id);
    expect(active.definition.lexicon.dimensions.targetRoles["VP Marketing"]).toContain(
      "Marketing VP",
    );
    expect(active.definition.taxonomy.descriptions["VP Marketing"]).toBe(
      "Executive marketing leadership.",
    );
    const compiled = SearchPlanner.plan(
      {
        targetLevel: ["VP"],
        functions: ["Marketing"],
        targetTitles: ["VP Marketing"],
        preferredLocations: ["Mumbai"],
      },
      active.definition.taxonomy,
      active.definition.lexicon,
    );
    expect(compiled.rankedQueries.map((query) => query.query)).toContain("Marketing VP");
    expect(
      (
        await db.one<{ n: number }>(
          "SELECT COUNT(*) n FROM admin_audit_log WHERE action='taxonomy.publish'",
        )
      )?.n,
    ).toBe(1);
  });

  it("rejects generic new aliases, duplicate aliases and stale publication", async () => {
    const db = await fixture();
    await expect(
      mutate(db, {
        kind: "draft_concept",
        dimension: "targetRoles",
        concept: "VP Marketing",
        description: "Marketing leadership",
        phrases: ["VP Marketing", "Vice President Marketing", "VP"],
        reason: "unsafe generic designation",
      }),
    ).rejects.toThrow("TAXONOMY_ALIAS_NEEDS_FUNCTIONAL_SIGNAL");
    await expect(
      mutate(db, {
        kind: "draft_concept",
        dimension: "targetRoles",
        concept: "VP Marketing",
        description: "Marketing leadership",
        phrases: ["VP Marketing", "CMO"],
        reason: "duplicate designation",
      }),
    ).rejects.toThrow("TAXONOMY_DUPLICATE_ALIAS");
    const first = await mutate(db, {
      kind: "draft_concept",
      dimension: "targetRoles",
      concept: "VP Marketing",
      description: "Marketing leadership",
      phrases: ["VP Marketing", "Vice President Marketing", "Marketing VP"],
      reason: "first draft",
    });
    const second = await mutate(db, {
      kind: "draft_concept",
      dimension: "targetRoles",
      concept: "Head of Growth",
      description: "Growth leadership",
      phrases: ["Head of Growth", "VP Growth", "Growth leadership"],
      reason: "replace draft",
    });
    await expect(
      mutate(db, { kind: "publish", revisionId: first.id, reason: "stale publish" }),
    ).rejects.toThrow("TAXONOMY_DRAFT_CHANGED");
    await mutate(db, { kind: "publish", revisionId: second.id, reason: "publish current draft" });
  });

  it("keeps an existing plan's persisted queries independent of later taxonomy revisions", async () => {
    const db = await fixture();
    const criteria = {
      targetRoles: ["VP Marketing"],
      targetSeniority: ["VP"],
      targetLocations: ["Mumbai"],
      customParameters: {
        functions: ["Marketing"],
        generatedQueries: ["VP Marketing", "Marketing VP"],
      },
    };
    await db.execute("UPDATE search_plans SET criteria_json=? WHERE id='plan_A'", [
      JSON.stringify(criteria),
    ]);
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify(criteria),
    ]);
    const result = await ScraperPlanResolver.resolveActivePlan(
      { tenantId: "tenant_A", personId: "person_A", roles: [] },
      undefined,
      db,
      "plan_A",
    );
    expect(result.queries).toEqual(["VP Marketing", "Marketing VP"]);
  });

  it("requires an exact query-impact shadow before publishing a structural change", async () => {
    const db = await fixture();
    const criteria = {
      targetRoles: ["VP Marketing"],
      targetSeniority: ["VP"],
      targetLocations: ["Mumbai"],
      customParameters: { functions: ["Marketing"], generatedQueries: ["VP Marketing"] },
    };
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify(criteria),
    ]);
    await activateLineageTestContext(db);
    const draft = await mutate(db, {
      kind: "add_concept",
      dimension: "targetRoles",
      concept: "Regional Growth Lead",
      description: "Regional commercial growth leadership.",
      phrases: ["Regional Growth Lead"],
      ring: "adjacent",
      reason: "add a regional growth discovery concept",
    });
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: draft.id,
        confirmation: "PUBLISH",
        reason: "skip required impact test",
      }),
    ).rejects.toThrow("TAXONOMY_SHADOW_REQUIRED");
    await mutate(db, { kind: "shadow", revisionId: draft.id, reason: "compare active plans" });
    const run = await db.one<{ status: string; result_json: string }>(
      "SELECT status,result_json FROM taxonomy_shadow_runs WHERE revision_id=?",
      [draft.id],
    );
    expect(run?.status).toBe("passed");
    expect(JSON.parse(String(run?.result_json))).toMatchObject({ plansExamined: 1 });
    await mutate(db, {
      kind: "publish",
      revisionId: draft.id,
      confirmation: "PUBLISH",
      reason: "publish measured change",
    });
    const active = await activeSearchTaxonomy(db);
    expect(active.definition.lexicon.dimensions.targetRoles["Regional Growth Lead"]).toEqual([
      "Regional Growth Lead",
    ]);
    expect(active.definition.taxonomy.concentricRings.adjacent).toContain("Regional Growth Lead");
  });
  it("does not clear structural protection through an alias edit or a restore", async () => {
    const db = await fixture();
    const baseline = (await activeSearchTaxonomy(db)).id;
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify({
        targetRoles: ["VP Marketing"],
        customParameters: { functions: ["Marketing"] },
      }),
    ]);
    await activateLineageTestContext(db);
    await mutate(db, {
      kind: "add_concept",
      dimension: "targetRoles",
      concept: "Growth Partner",
      description: "Growth ownership",
      phrases: ["Growth Partner"],
      ring: "adjacent",
      reason: "structural draft",
    });
    const edited = await mutate(db, {
      kind: "draft_concept",
      dimension: "targetRoles",
      concept: "Growth Partner",
      description: "Growth leadership",
      phrases: ["Growth Partner"],
      reason: "metadata edit",
    });
    expect((await readTaxonomySnapshot(db, "op")).draft?.requires_shadow).toBe(1);
    await expect(
      mutate(db, { kind: "publish", revisionId: edited.id, reason: "attempt bypass" }),
    ).rejects.toThrow("TAXONOMY_STRUCTURAL_CONFIRMATION_REQUIRED");
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: edited.id,
        confirmation: "PUBLISH",
        reason: "attempt bypass",
      }),
    ).rejects.toThrow("TAXONOMY_SHADOW_REQUIRED");
    await mutate(db, { kind: "shadow", revisionId: edited.id, reason: "measure query impact" });
    await expect(db.execute("UPDATE taxonomy_shadow_runs SET status='failed'")).rejects.toThrow(
      "TAXONOMY_SHADOW_IMMUTABLE",
    );
    await expect(db.execute("DELETE FROM taxonomy_shadow_runs")).rejects.toThrow(
      "TAXONOMY_SHADOW_IMMUTABLE",
    );
    await mutate(db, {
      kind: "publish",
      revisionId: edited.id,
      confirmation: "PUBLISH",
      reason: "measured publication",
    });
    const restored = await mutate(db, {
      kind: "revert",
      revisionId: baseline,
      reason: "restore baseline",
    });
    expect((await readTaxonomySnapshot(db, "op")).draft?.requires_shadow).toBe(1);
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: restored.id,
        confirmation: "PUBLISH",
        reason: "attempt restore bypass",
      }),
    ).rejects.toThrow("TAXONOMY_SHADOW_REQUIRED");
  });
  it("rejects empty shadow scopes and invalidates proof when authority changes", async () => {
    const db = await fixture();
    const draft = await mutate(db, {
      kind: "retire_concept",
      dimension: "targetRoles",
      concept: "VP Marketing",
      reason: "retire discovery label",
    });
    await expect(
      mutate(db, { kind: "shadow", revisionId: draft.id, reason: "empty scope" }),
    ).rejects.toThrow("TAXONOMY_SHADOW_SCOPE_EMPTY");
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify({
        targetRoles: ["VP Marketing"],
        customParameters: { functions: ["Marketing"] },
      }),
    ]);
    await activateLineageTestContext(db);
    await mutate(db, { kind: "shadow", revisionId: draft.id, reason: "exact snapshot cohort" });
    // Mutable plan criteria are not the source of shadow authority.
    await db.execute("UPDATE search_plans SET criteria_json='invalid' WHERE id='plan_A'");
    await mutate(db, {
      kind: "shadow",
      revisionId: draft.id,
      reason: "snapshot remains authoritative",
    });
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify({ targetRoles: ["Head of Growth"] }),
    ]);
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: draft.id,
        confirmation: "PUBLISH",
        reason: "stale scope publication",
      }),
    ).rejects.toThrow("TAXONOMY_SHADOW_STALE");
  });
  it("rejects reserved object keys and corrupt pinned query payloads", async () => {
    const db = await fixture();
    await expect(
      mutate(db, {
        kind: "add_concept",
        dimension: "targetRoles",
        concept: "__proto__",
        description: "bad key",
        phrases: ["Growth Partner"],
        ring: "adjacent",
        reason: "reserved key",
      }),
    ).rejects.toThrow("Reserved taxonomy key");
    await db.execute("UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'", [
      JSON.stringify({
        targetRoles: ["VP Marketing"],
        customParameters: { taxonomyRevisionId: "pinned", generatedQueries: [] },
      }),
    ]);
    await expect(
      ScraperPlanResolver.resolveActivePlan(
        { tenantId: "tenant_A", personId: "person_A", roles: [] },
        undefined,
        db,
        "plan_A",
      ),
    ).rejects.toThrow("PINNED_SEARCH_QUERIES_INVALID");
  });
  it("validates global identities, hierarchy and retired ancestors", () => {
    expect(validateIntelligenceTaxonomy(baselineIntelligenceTaxonomy).nodes.length).toBeGreaterThan(
      20,
    );
    const graph = structuredClone(baselineIntelligenceTaxonomy);
    graph.nodes.push({ ...graph.nodes[0] });
    expect(() => validateIntelligenceTaxonomy(graph)).toThrow("INTELLIGENCE_DUPLICATE_ID");
    graph.nodes.pop();
    const cap = graph.nodes.find((n) => n.kind === "capability")!;
    cap.parentId = graph.nodes.find((n) => n.kind === "domain")!.id;
    expect(() => validateIntelligenceTaxonomy(graph)).toThrow("INTELLIGENCE_INVALID_PARENT");
    cap.parentId = baselineIntelligenceTaxonomy.nodes.find((n) => n.id === cap.id)!.parentId;
    graph.nodes.find((n) => n.id === cap.parentId)!.retired = true;
    expect(() => validateIntelligenceTaxonomy(graph)).toThrow("INTELLIGENCE_RETIRED_PARENT");
  });
  it("pins intelligence and rejects fingerprint corruption without changing baseline", () => {
    const before = JSON.stringify(baselineIntelligenceTaxonomy),
      pin = pinIntelligence("revision", baselineIntelligenceTaxonomy);
    expect(readPinnedIntelligence(pin)?.revisionId).toBe("revision");
    expect(() => readPinnedIntelligence({ ...pin, fingerprint: "bad" })).toThrow(
      "INTELLIGENCE_SNAPSHOT_FINGERPRINT_MISMATCH",
    );
    const frozen = { ...benchFixtures()[0], intelligenceTaxonomy: pin };
    frozen.fingerprint = contextInputFingerprint(frozen);
    expect(validateSnapshot(frozen).intelligenceTaxonomy?.fingerprint).toBe(pin.fingerprint);
    expect(JSON.stringify(baselineIntelligenceTaxonomy)).toBe(before);
  });
  it("keeps unfamiliar titles admitted and explicit company exclusions hard", async () => {
    const db = await fixture(),
      specimen = (await intelligenceShadowCases(db))[0];
    const criteria = {
      ...specimen.criteria,
      customParameters: {
        functions: ["Performance Marketing"],
        intelligenceTaxonomy: pinIntelligence("pinned", baselineIntelligenceTaxonomy),
      },
    };
    const op = {
      ...specimen.version,
      jobTitle: "Customer Momentum Steward",
      rawContent: "Lead paid search and improve ROAS.",
    };
    expect(evaluateAttentionGate(op, criteria).decision).toBe("CANDIDATE");
    expect(
      evaluateAttentionGate(op, { ...criteria, excludedCompanies: [op.companyName!] }),
    ).toMatchObject({ decision: "NOT_CANDIDATE", reasonCodes: ["EXCLUDED_COMPANY"] });
    expect(evaluateAttentionGate(op, specimen.criteria).eligibility).toBe("REVIEW");
    expect(
      matchIntelligence(baselineIntelligenceTaxonomy, op.rawContent).some(
        (n) => n.id === "perf_mkt",
      ),
    ).toBe(true);
  });
  it("requires model shadow for classification even after alias edits", async () => {
    const db = await fixture();
    await mutate(db, {
      kind: "intelligence_classify",
      nodeId: "perf_mkt",
      classification: "ADJACENT",
      reason: "advisory class",
    });
    const draft = await mutate(db, {
      kind: "intelligence_edit",
      nodeId: "perf_mkt",
      name: "Performance Marketing",
      description: "Paid growth",
      aliases: ["paid search", "ROAS"],
      reason: "adjust aliases",
    });
    expect((await readTaxonomySnapshot(db, "op")).draft?.requires_shadow).toBe(1);
    await expect(
      mutate(db, {
        kind: "publish",
        revisionId: draft.id,
        confirmation: "PUBLISH",
        reason: "skip shadow",
      }),
    ).rejects.toThrow("INTELLIGENCE_SHADOW_REQUIRED");
  });
  it("preserves identities while moving and retiring a subtree", async () => {
    const db = await fixture(),
      original = JSON.stringify(baselineIntelligenceTaxonomy);
    await mutate(db, {
      kind: "intelligence_move",
      nodeId: "perf_mkt",
      parentId: "brand_communications",
      reason: "move a capability",
    });
    expect(
      (await readTaxonomySnapshot(db, "op")).draft?.definition.intelligence?.nodes.find(
        (n) => n.id === "perf_mkt",
      )?.parentId,
    ).toBe("brand_communications");
    await mutate(db, {
      kind: "intelligence_retire",
      nodeId: "brand_communications",
      reason: "retire grouping",
    });
    expect(
      (await readTaxonomySnapshot(db, "op")).draft?.definition.intelligence?.nodes.find(
        (n) => n.id === "perf_mkt",
      )?.retired,
    ).toBe(true);
    expect(JSON.stringify(baselineIntelligenceTaxonomy)).toBe(original);
  });
  it("publishes a complete safe shadow without creating canonical evaluations", async () => {
    const db = await fixture(),
      draft = await mutate(db, {
        kind: "intelligence_classify",
        nodeId: "perf_mkt",
        classification: "ADJACENT",
        reason: "semantic draft",
      }),
      before = await db.one("SELECT COUNT(*) n FROM staged_evaluations");
    const queued = await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000000,
      limit: 3,
      reason: "golden comparison",
    });
    const audit = await db.one<{ detail_json: string }>(
      "SELECT detail_json FROM admin_audit_log WHERE action='taxonomy.intelligence_shadow' AND target=?",
      [queued.id],
    );
    expect(JSON.parse(audit!.detail_json)).toMatchObject({
      after: { revisionId: draft.id },
      shadowJobId: queued.id,
    });
    const worker = new IntelligenceShadowWorker(db, async (_row, cases) => ({
      version: INTELLIGENCE_SHADOW_VERSION,
      safeToPublish: true,
      cases: cases.map((c) => ({
        id: c.id,
        beforeAdmission: "CANDIDATE:REVIEW",
        afterAdmission: "CANDIDATE:REVIEW",
        beforeVerdict: c.id === "mandatory-license" ? "PASS" : "CONSIDER",
        afterVerdict: c.id === "mandatory-license" ? "PASS" : "CONSIDER",
        beforeViability: c.id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
        afterViability: c.id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
      })),
      admissionsChanged: 0,
      verdictsChanged: 0,
      passToPursue: 0,
      invalidOutputs: 0,
      repairs: 0,
    }));
    expect(await worker.pollOnce()).toMatchObject({ id: queued.id, status: "passed" });
    await expect(
      db.execute("UPDATE intelligence_taxonomy_shadows SET result_json='{}' WHERE id=?", [
        queued.id,
      ]),
    ).rejects.toThrow("INTELLIGENCE_SHADOW_IMMUTABLE");
    await mutate(db, {
      kind: "publish",
      revisionId: draft.id,
      confirmation: "PUBLISH",
      reason: "publish fixture change",
    });
    expect(
      (await activeSearchTaxonomy(db)).definition.intelligence?.nodes.find(
        (n) => n.id === "perf_mkt",
      )?.classification,
    ).toBe("ADJACENT");
    expect(await db.one("SELECT COUNT(*) n FROM staged_evaluations")).toEqual(before);
  });
  it("blocks harmful verdict flips, invalid output and relaxed screening", () => {
    const result: IntelligenceShadowResult = {
      version: INTELLIGENCE_SHADOW_VERSION,
      safeToPublish: true,
      cases: [
        {
          id: "case",
          beforeAdmission: "CANDIDATE:REVIEW",
          afterAdmission: "CANDIDATE:ELIGIBLE",
          beforeVerdict: "PASS",
          afterVerdict: "PURSUE",
          beforeViability: "PLAUSIBLE",
          afterViability: "PLAUSIBLE",
        },
      ],
      admissionsChanged: 0,
      verdictsChanged: 0,
      passToPursue: 0,
      invalidOutputs: 0,
      repairs: 0,
    };
    expect(assessIntelligenceShadow(result, ["case"])).toMatchObject({
      safeToPublish: false,
      passToPursue: 1,
      admissionsChanged: 1,
      verdictsChanged: 1,
    });
    result.cases[0].afterVerdict = "PASS";
    result.invalidOutputs = 1;
    expect(assessIntelligenceShadow(result, ["case"]).safeToPublish).toBe(false);
    result.invalidOutputs = 0;
    result.repairs = 1;
    result.cases[0].beforeViability = "PLAUSIBLE";
    expect(assessIntelligenceShadow(result, ["case"]).safeToPublish).toBe(true);
    result.repairs = 0;
    result.cases[0].beforeViability = "BLOCKED";
    expect(assessIntelligenceShadow(result, ["case"]).safeToPublish).toBe(false);
    expect(assessIntelligenceShadow(result, ["case", "missing"]).safeToPublish).toBe(false);
  });
  it("fails revoked-operator jobs and rejects empty real scope", async () => {
    const db = await fixture(),
      draft = await mutate(db, {
        kind: "intelligence_classify",
        nodeId: "perf_mkt",
        classification: "CONTEXT",
        reason: "context vocabulary",
      });
    await expect(
      mutate(db, {
        kind: "intelligence_shadow",
        revisionId: draft.id,
        tokenCap: 1000000,
        limit: 3,
        tenantId: "tenant_A",
        reason: "explicit real selection",
      }),
    ).rejects.toThrow("INTELLIGENCE_SHADOW_REAL_SCOPE_EMPTY");
    const queued = await mutate(db, {
      kind: "intelligence_shadow",
      revisionId: draft.id,
      tokenCap: 1000000,
      limit: 3,
      reason: "fixture shadow",
    });
    await db.execute("UPDATE platform_roles SET revoked_at=1 WHERE user_id='op'");
    expect(await new IntelligenceShadowWorker(db).pollOnce()).toBeNull();
    expect(
      await db.one("SELECT status FROM intelligence_taxonomy_shadows WHERE id=?", [queued.id]),
    ).toMatchObject({ status: "failed" });
  });
});
