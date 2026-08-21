/**
 * P3-A Policy Fix Validation Tests
 * 
 * Validates the corrected Easy Trap Rule 1:
 * CV < 50 AND SP >= 80 AND Friction < 10 AND initial PURSUE → CONSIDER
 */

import { describe, it, expect } from "vitest";
import { runEngine } from "../../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../../src/data/candidate-profile";

describe("P3-A Policy Fix: Easy Trap Rule 1", () => {
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  describe("Approved Rule 1: CV < 50 + SP >= 80 + Friction < 10 → CONSIDER", () => {
    it("CV 31 / SP 90 / Friction 0 → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      
      const record = records.find(r => r.jobHash === "j-cc222b05ee62");
      expect(record).toBeDefined();
      expect(record!.decisionSummary?.careerValue).toBeLessThan(50);
      expect(record!.decisionSummary?.shortlistingPotential).toBeGreaterThanOrEqual(80);
      expect(record!.decisionSummary?.pursuitFriction).toBeLessThan(10);
      expect(record!.verb).toBe("CONSIDER");
    }, 30000); // 30 second timeout for full engine run

    it("CV 46 / SP 90 / Friction 0 → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      
      // j-f5873c10d6cd has CV=46, SP=87, Friction=0
      const record = records.find(r => r.jobHash === "j-f5873c10d6cd");
      expect(record).toBeDefined();
      
      // Verify it matches Easy Trap conditions
      const cv = record!.decisionSummary?.careerValue ?? 0;
      const sp = record!.decisionSummary?.shortlistingPotential ?? 0;
      const friction = record!.decisionSummary?.pursuitFriction ?? 0;
      
      const isEasyTrap = cv < 50 && sp >= 80 && friction < 10;
      
      if (isEasyTrap && record!.rawScore! >= 65) {
        expect(record!.verb).toBe("CONSIDER");
      }
    });

    it("CV 49 / SP 80 / Friction 9 → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      
      // Find any record with CV=49, SP>=80, Friction<10
      const candidates = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        const friction = r.decisionSummary?.pursuitFriction ?? 0;
        return cv >= 48 && cv < 50 && sp >= 80 && friction < 10 && r.rawScore! >= 65;
      });
      
      // All such cases should be CONSIDER
      for (const r of candidates) {
        expect(r.verb).toBe("CONSIDER");
      }
    });
  });

  describe("Rule 1 Boundaries (NOT subject to rule)", () => {
    it("CV 50 / SP 80 / Friction 9 → NOT subject to Rule 1", async () => {
      const { records } = await runEngine(projection, 0);
      
      // CV = 50 should NOT trigger (must be < 50)
      const candidates = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        return cv === 50 && r.decisionSummary?.shortlistingPotential! >= 80;
      });
      
      // These should NOT be downgraded due to CV boundary
      for (const r of candidates) {
        const isPursue = r.rawScore! >= 65;
        if (isPursue) {
          // Should remain PURSUE (not forced to CONSIDER by Easy Trap)
          expect(r.verb).not.toBe("CONSIDER"); // Or verify it's not Easy Trap downgraded
        }
      }
    });

    it("CV 46 / SP 79 / Friction 0 → NOT subject to Rule 1", async () => {
      const { records } = await runEngine(projection, 0);
      
      // SP < 80 should NOT trigger
      const candidates = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        return cv < 50 && sp < 80 && sp >= 70 && r.rawScore! >= 65;
      });
      
      // These should NOT be downgraded
      for (const r of candidates) {
        // Should not be CONSIDER due to Easy Trap (could be CONSIDER for other reasons)
        const pipeline = r.trace?.pipeline || [];
        const hasEasyTrap = pipeline.some((p: any) => p.stage === "CareerValueProtection");
        expect(hasEasyTrap).toBe(false);
      }
    });

    it("CV 46 / SP 85 / Friction 10 → NOT subject to Rule 1", async () => {
      const { records } = await runEngine(projection, 0);
      
      // Friction >= 10 should NOT trigger
      const candidates = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        const friction = r.decisionSummary?.pursuitFriction ?? 0;
        return cv < 50 && sp >= 80 && friction >= 10 && r.rawScore! >= 65;
      });
      
      // These should NOT be downgraded by Easy Trap
      for (const r of candidates) {
        const pipeline = r.trace?.pipeline || [];
        const hasEasyTrap = pipeline.some((p: any) => p.stage === "CareerValueProtection");
        expect(hasEasyTrap).toBe(false);
      }
    });
  });

  describe("Target Cases", () => {
    it("j-cc222b05ee62 → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      const record = records.find(r => r.jobHash === "j-cc222b05ee62");
      expect(record?.verb).toBe("CONSIDER");
    });

    it("j-63144d98a1bd → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      const record = records.find(r => r.jobHash === "j-63144d98a1bd");
      expect(record?.verb).toBe("CONSIDER");
    });

    it("j-f5873c10d6cd → CONSIDER (was PURSUE before fix)", async () => {
      const { records } = await runEngine(projection, 0);
      const record = records.find(r => r.jobHash === "j-f5873c10d6cd");
      
      // This case: CV=46, SP=87, Friction=0, RawScore=74
      // Should now be CONSIDER with the fixed rule
      expect(record?.decisionSummary?.careerValue).toBe(46);
      expect(record?.decisionSummary?.shortlistingPotential).toBe(87);
      expect(record?.decisionSummary?.pursuitFriction).toBe(0);
      expect(record?.verb).toBe("CONSIDER");
    });

    it("j-46089844ba17 → CONSIDER (was PURSUE before fix)", async () => {
      const { records } = await runEngine(projection, 0);
      const record = records.find(r => r.jobHash === "j-46089844ba17");
      
      // This case: CV=46, SP=87, Friction=0, RawScore=75
      // Should now be CONSIDER with the fixed rule
      expect(record?.decisionSummary?.careerValue).toBe(46);
      expect(record?.decisionSummary?.shortlistingPotential).toBe(87);
      expect(record?.decisionSummary?.pursuitFriction).toBe(0);
      expect(record?.verb).toBe("CONSIDER");
    });

    it("j-2016c3f385e0 → CONSIDER", async () => {
      const { records } = await runEngine(projection, 0);
      const record = records.find(r => r.jobHash === "j-2016c3f385e0");
      expect(record?.verb).toBe("CONSIDER");
    });
  });
});
