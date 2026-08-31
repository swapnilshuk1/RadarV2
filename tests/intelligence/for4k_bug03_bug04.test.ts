process.env.RADAR_USE_TURSO = "true";
import { describe, it, expect } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { isEvaluated } from "../../src/data/opportunity-fixtures";

describe("FOR-4K: BUG-03 and BUG-04 Authoritative Tests", { timeout: 30000 }, () => {
  const db = getDatabaseAdapter();
  const store = new SqliteCanonicalServingStore(db);
  const scope = {
    tenantId: "tenant_default",
    personId: "ms6i7e3y-4x0chy5fy",
    roles: ["executive"]
  };

  it("BUG-03: Zero orphan canonical opportunities without versions", async () => {
    const canonCount = await db.one<{ cnt: number }>("SELECT COUNT(*) as cnt FROM canonical_opportunities");
    const verCount = await db.one<{ cnt: number }>("SELECT COUNT(*) as cnt FROM opportunity_versions");
    
    expect(canonCount?.cnt).toBeGreaterThanOrEqual(3035);
    expect(verCount?.cnt).toBe(canonCount?.cnt);

    const orphans = await db.many<any>(`
      SELECT co.id 
      FROM canonical_opportunities co
      LEFT JOIN opportunity_versions ov ON ov.canonical_job_id = co.id
      WHERE ov.id IS NULL
    `);
    expect(orphans.length).toBe(0);

    const targetLinkage = await db.one<any>(`
      SELECT co.id as canon_id, ov.id as ver_id
      FROM canonical_opportunities co
      JOIN opportunity_versions ov ON ov.canonical_job_id = co.id
      WHERE co.id = '7e3589afb485195b6e3eb31f13e3048c48aea4356740e72c68f8ad4354fda89e'
    `);
    expect(targetLinkage?.ver_id).toBe("ver_7e3589afb485195b");
  });

  it("BUG-04: All 10 sparse decisions remain represented in Decisions surface", async () => {
    const opps = await store.listOpportunities(scope);
    expect(opps.length).toBeGreaterThanOrEqual(3002);

    const decisionsSurfaceOpps = opps.filter((o: any) => isEvaluated(o) || Boolean(o.userDecision?.userAction));
    expect(decisionsSurfaceOpps.length).toBeGreaterThanOrEqual(2000);

    const decidedSparse = opps.filter((o: any) => o.evaluationState === "SPARSE_SPEC" && Boolean(o.userDecision?.userAction));
    expect(decidedSparse.length).toBe(10);

    const sparseActions = decidedSparse.map((o: any) => o.userDecision?.userAction).sort();
    expect(sparseActions.filter(a => a === "PURSUE").length).toBe(2);
    expect(sparseActions.filter(a => a === "CONSIDER").length).toBe(1);
    expect(sparseActions.filter(a => a === "PASS").length).toBe(7);
  });

  it("Stage Separation Invariant: Sparse opportunities never enter RADAR Shortlist", async () => {
    const opps = await store.listOpportunities(scope);
    const remaining = opps.filter((o: any) => {
      const userVerb = o.userDecision?.userAction;
      return userVerb !== "PURSUE" && userVerb !== "CONSIDER" && userVerb !== "PASS";
    });

    const shortlistedOps = remaining.filter((o: any) => {
      if (!isEvaluated(o)) return false;
      const v = o.engineRecommendation?.engineVerdict;
      return v === "PURSUE" || v === "CONSIDER";
    });

    expect(shortlistedOps.length).toBeGreaterThanOrEqual(82);

    const sparseInShortlist = shortlistedOps.filter((o: any) => o.evaluationState === "SPARSE_SPEC");
    expect(sparseInShortlist.length).toBe(0);
  });

  it("Serving Metrics Invariants: 645 Shortlist, 82 Review Queue, 472/137/889 Evaluated Decisions", async () => {
    const metrics = await store.getOpportunityMetrics(scope);

    expect(metrics.totalScreened).toBeGreaterThanOrEqual(3002);
    expect(metrics.totalShortlisted).toBeGreaterThanOrEqual(645);
    expect(metrics.discoveryMetrics?.actionableReviewQueue).toBeGreaterThanOrEqual(82);

    expect(metrics.userBreakdown.pursue).toBe(472);
    expect(metrics.userBreakdown.consider).toBe(137);
    expect(metrics.userBreakdown.pass).toBe(889);
    expect(metrics.userBreakdown.total).toBe(1498);

    expect(metrics.decisionMetrics?.sparseDecisions?.total).toBe(10);
    expect(metrics.decisionMetrics?.sparseDecisions?.pursue).toBe(2);
    expect(metrics.decisionMetrics?.sparseDecisions?.consider).toBe(1);
    expect(metrics.decisionMetrics?.sparseDecisions?.pass).toBe(7);

    expect(metrics.totalDecisions).toBe(1498);
  });

  it("Decision Immutability Invariant: Zero canonical user decisions mutated", async () => {
    const decisions = await db.many<any>(`
      SELECT action, count(*) as cnt 
      FROM canonical_decisions 
      GROUP BY action 
      ORDER BY action
    `);

    expect(decisions).toEqual([
      { action: "CONSIDER", cnt: 138 },
      { action: "PASS", cnt: 897 },
      { action: "PURSUE", cnt: 474 },
    ]);
  });
});
