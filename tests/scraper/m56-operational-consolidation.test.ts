import { describe, it, expect } from "vitest";
import path from "path";
import { RunController } from "../../scripts/scraper/run/manager";
import { CareerIntentModel } from "../../scripts/scraper/run/career-intent";
import { SearchPlanner } from "../../scripts/scraper/run/search-planner";
import { HealthManager } from "../../scripts/scraper/run/health-manager";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

describe("M5.6 Operational Consolidation & Accounting Invariant Suite", () => {
  it("Test 1: RunController.recordActivity is defensive and does not throw before init()", () => {
    const mgr = new RunController();
    // Before init(), manifest is undefined. Calling recordActivity must not throw.
    expect(() => {
      mgr.recordActivity("Testing pre-init activity recording");
    }).not.toThrow();
  });

  it("Test 2: CareerIntentModel + SearchPlanner dynamically generate ranked queries without crashing", () => {
    const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");
    const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
    const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");

    const intent = CareerIntentModel.extractIntent(profilePath, taxonomyPath);
    expect(intent.targetLevel.length).toBeGreaterThan(0);
    expect(intent.functions.length).toBeGreaterThan(0);

    const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
    expect(searchPlan.rankedQueries.length).toBeGreaterThan(0);
    expect(searchPlan.rankedQueries[0]).toHaveProperty("query");
    expect(searchPlan.rankedQueries[0]).toHaveProperty("score");
  });

  it("Test 3: Accounting invariant strictly satisfies cardsParsed === classified upon run cancellation", () => {
    const mgr = new RunController();
    mgr.init({
      keywords: ["Chief Marketing Officer"],
      portals: ["LinkedIn"],
      maxPages: 1,
      maxCardsPerPage: 10,
      resume: false,
    });

    const parentUnitId = mgr.manifest.units[0].id;
    const feedCards = [
      { id: `${parentUnitId}#hash1`, cardHash: "hash1" },
      { id: `${parentUnitId}#hash2`, cardHash: "hash2" },
      { id: `${parentUnitId}#hash3`, cardHash: "hash3" },
      { id: `${parentUnitId}#hash4`, cardHash: "hash4" },
      { id: `${parentUnitId}#hash5`, cardHash: "hash5" },
    ];

    // Add cards in pending state
    mgr.addCards(parentUnitId, feedCards);

    // Simulate 2 cards processed before cancellation
    mgr.updateCard(`${parentUnitId}#hash1`, { status: "done", isNew: true });
    mgr.updateCard(`${parentUnitId}#hash2`, { status: "skipped_empty", error: "Junior title detected" });

    // Simulate cancellation requested
    mgr.transitionTo("stopping");
    expect(mgr.isCancellationRequested()).toBe(true);

    // Accounting reconciliation logic as implemented in scrape.ts
    let canonicalDuplicates = 0;
    let ledgerKnown = 0;
    let hardFiltered = 0;
    let identityFailed = 0;
    let novelAccepted = 0;
    let cancelledOrPruned = 0;

    for (const feedCard of feedCards) {
      const cardUnitId = feedCard.id;
      const cu = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cu) continue;

      if (mgr.isCancellationRequested() && (cu.status === "pending" || cu.status === "running")) {
        mgr.updateCard(cardUnitId, { status: "skipped_pruned", error: "Run cancelled/aborted" });
      }

      if (cu.status === "skipped_empty") {
        const errStr = cu.error || "";
        if (errStr.toLowerCase().includes("duplicate")) {
          canonicalDuplicates++;
        } else if (errStr.toLowerCase().includes("ledger")) {
          ledgerKnown++;
        } else {
          hardFiltered++;
        }
      } else if (cu.status === "failed") {
        identityFailed++;
      } else if (cu.status === "skipped_pruned" || cu.status === "skipped_gated") {
        cancelledOrPruned++;
      } else if (cu.status === "done") {
        if (!cu.isNew) {
          canonicalDuplicates++;
        } else {
          novelAccepted++;
        }
      }
    }

    const cardsParsed = feedCards.length;
    const classified = canonicalDuplicates + ledgerKnown + hardFiltered + identityFailed + novelAccepted + cancelledOrPruned;

    expect(cardsParsed).toBe(5);
    expect(novelAccepted).toBe(1);
    expect(hardFiltered).toBe(1);
    expect(cancelledOrPruned).toBe(3);
    expect(classified).toBe(cardsParsed);
  });

  it("Test 4: HealthManager FastPath circuit breaker trips to OPEN upon consecutive failures and recovers on success", () => {
    const portal = "Naukri";
    HealthManager.recordFastPathSuccess(portal);
    expect(HealthManager.isFastPathAvailable(portal)).toBe(true);

    // Record 5 failures
    for (let i = 0; i < 5; i++) {
      HealthManager.recordFastPathFailure(portal, "EmptyBody");
    }

    // Circuit breaker should trip to OPEN / disabled
    expect(HealthManager.isFastPathAvailable(portal)).toBe(false);

    // Recording success resets circuit to CLOSED / healthy
    HealthManager.recordFastPathSuccess(portal);
    expect(HealthManager.isFastPathAvailable(portal)).toBe(true);
  });

  it("Test 5: Mechanical M5 serving invariant — OpportunityService must NOT import or call bulk runEngine or OpportunityProvider", () => {
    const fs = require("fs");
    const oppServiceSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/intelligence/opportunity-service.ts"),
      "utf-8"
    );

    // Bulk synchronous engine and legacy OpportunityProvider must be absent
    expect(oppServiceSrc).not.toContain("runEngine(");
    expect(oppServiceSrc).not.toContain("import { runEngine }");
    expect(oppServiceSrc).not.toContain("OpportunityProvider");
  });
});
