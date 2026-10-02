import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import {
  activeSearchTaxonomy,
  mutateTaxonomy as rawMutateTaxonomy,
  readTaxonomySnapshot,
} from "../../src/admin/taxonomy-store";
import { ScraperPlanResolver } from "../../src/acquisition/plan-resolver";
import { SearchPlanner } from "../../scripts/scraper/run/search-planner";

const cleanup: SqliteAdapter[] = [];
afterEach(async () => {
  for (const db of cleanup.splice(0)) await db.close();
});

async function fixture() {
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
    await db.execute("UPDATE search_plans SET criteria_json=?", [JSON.stringify(criteria)]);
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
      mutate(db, { kind: "publish", revisionId: draft.id, reason: "skip required impact test" }),
    ).rejects.toThrow("TAXONOMY_SHADOW_REQUIRED");
    await mutate(db, { kind: "shadow", revisionId: draft.id, reason: "compare active plans" });
    const run = await db.one<{ status: string; result_json: string }>(
      "SELECT status,result_json FROM taxonomy_shadow_runs WHERE revision_id=?",
      [draft.id],
    );
    expect(run?.status).toBe("passed");
    expect(JSON.parse(String(run?.result_json))).toMatchObject({ plansExamined: 2 });
    await mutate(db, { kind: "publish", revisionId: draft.id, reason: "publish measured change" });
    const active = await activeSearchTaxonomy(db);
    expect(active.definition.lexicon.dimensions.targetRoles["Regional Growth Lead"]).toEqual([
      "Regional Growth Lead",
    ]);
    expect(active.definition.taxonomy.concentricRings.adjacent).toContain("Regional Growth Lead");
  });
});
