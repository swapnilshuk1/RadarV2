import { describe, it, expect } from "vitest";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { resolveEffectiveDecision } from "../../src/lib/intelligence/decision-resolver";

describe("Milestone M8 — Canonical Executive Serving Path", () => {
  const userId = "ms6i7e3y-4x0chy5fy";

  describe("M8.1 & M8.2: Canonical OpportunityService & Effective Decision Resolution", () => {
    it("should serve candidate opportunities through canonical lineage for active tenant/user", async () => {
      const opps = await OpportunityService.listForUser(userId);

      expect(opps).toBeDefined();
      expect(Array.isArray(opps)).toBe(true);
      expect(opps.length).toBeGreaterThan(0);

      const first = opps[0];
      expect(first).toBeDefined();
      expect(first.jobHash).toBeDefined();
      expect(typeof first.role).toBe("string");
      expect(typeof first.company).toBe("string");
      expect(first.effectiveDecision).toBeDefined();
      expect(first.engineRecommendation).toBeDefined();
    });

    it("should retrieve a single opportunity DTO by jobHash matching canonical store", async () => {
      const opps = await OpportunityService.listForUser(userId);
      const target = opps[0];

      const single = await OpportunityService.getForUser(userId, target.jobHash);
      expect(single).toBeDefined();
      expect(single?.jobHash).toBe(target.jobHash);
      expect(single?.role).toBe(target.role);
      expect(single?.company).toBe(target.company);
      expect(single?.effectiveDecision).toBe(target.effectiveDecision);
    });

    it("should compute authoritative canonical opportunity metrics with integrity verification", async () => {
      const metrics = await OpportunityService.getMetricsForUser(userId);

      expect(metrics).toBeDefined();
      expect(metrics.personId).toBe(userId);
      expect(metrics.totalScreened).toBeGreaterThan(0);
      expect(metrics.totalDecisions).toBeGreaterThanOrEqual(0);
      expect(metrics.engineBreakdown).toBeDefined();
      expect(metrics.effectiveBreakdown).toBeDefined();
      expect(metrics.categoryMetrics).toBeDefined();
      expect(metrics.integrity.status).toBe("PASS");
    });

    it("should list decided opportunities for user correctly", async () => {
      const decided = await OpportunityService.listDecidedForUser(userId);

      expect(decided).toBeDefined();
      expect(Array.isArray(decided)).toBe(true);
      for (const opp of decided) {
        expect(opp.userDecision).toBeDefined();
        expect(opp.userDecision?.userAction).not.toBe("NONE");
      }
    });

    it("should resolve adjacent navigation neighbours deterministically", async () => {
      const opps = await OpportunityService.listForUser(userId);
      if (opps.length >= 2) {
        const first = opps[0];
        const neighbours = await OpportunityService.neighboursForUser(userId, first.jobHash);
        expect(neighbours).toBeDefined();
        expect(neighbours.prev).toBeUndefined(); // First item has no previous
        expect(neighbours.next).toBeDefined();
        expect(neighbours.next?.jobHash).toBe(opps[1].jobHash);
      }
    });

    it("should adhere strictly to the canonical effective decision truth table precedence", () => {
      // 1. User PASS always results in USER_PASSED
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "PASS",
      })).toBe("USER_PASSED");

      // 2. User PURSUE + Engine PURSUE -> USER_CONFIRMED
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "PURSUE",
      })).toBe("USER_CONFIRMED");

      // 3. User PURSUE + Engine CONSIDER -> PREFERENCE_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "PURSUE",
      })).toBe("PREFERENCE_OVERRIDE");

      // 4. User PURSUE + Engine PASS/Veto -> VETO_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "PURSUE",
      })).toBe("VETO_OVERRIDE");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        vetoed: true,
        userAction: "PURSUE",
      })).toBe("VETO_OVERRIDE");

      // 5. User CONSIDER + Engine CONSIDER -> ENGINE_CONSIDER
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "CONSIDER",
      })).toBe("ENGINE_CONSIDER");

      // 6. User CONSIDER + Engine PASS/PURSUE -> PREFERENCE_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "CONSIDER",
      })).toBe("PREFERENCE_OVERRIDE");

      // 7. NOT_CANDIDATE with no user action -> NOT_EVALUABLE
      expect(resolveEffectiveDecision({
        attentionDecision: "NOT_CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "NONE",
      })).toBe("NOT_EVALUABLE");

      // 8. No user action + Engine verdicts
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "NONE",
      })).toBe("ENGINE_PURSUIT");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "NONE",
      })).toBe("ENGINE_CONSIDER");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "NONE",
      })).toBe("ENGINE_PASS");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "SPARSE_SPEC",
        userAction: "NONE",
      })).toBe("NOT_EVALUABLE");
    });
  });
});
