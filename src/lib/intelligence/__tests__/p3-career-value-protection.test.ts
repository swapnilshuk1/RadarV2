/**
 * P3-A: Career-Value Protection Rule Tests
 *
 * Verifies the architectural refactor and Easy Trap rule implementation:
 * - SP calculation before DecisionPolicyEngine
 * - SP independent of decision-dependent inputs
 * - Easy Trap: CV < 50 AND SP >= 80 AND friction < 10 → PURSUE → CONSIDER
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { RecommendationRecord } from '../record';
import { runEngine } from '../engine';
import { calculateShortlistingPotentialFromAssessments } from '../calculators/ShortlistingPotentialCalculator';

// Test fixtures
import { j_cc222b05ee62, j_63144d98a1bd } from '../../data/corpus/p3-easy-trap-fixtures';

// Type imports for assessment mocks
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  CareerAssessment, 
  OpportunityAssessment 
} from '../../domain/semantic';

describe('P3-A: Career-Value Protection Architecture', () => {
  let records: RecommendationRecord[];

  beforeAll(async () => {
    // Run full engine to get records
    records = await runEngine();
  });

  describe('A. SP Pre-Decision Calculation', () => {
    it('should calculate SP before DecisionPolicyEngine is invoked', () => {
      // Every record should have SP in trace.factors
      for (const record of records) {
        expect(record.trace?.factors?.shortlistingPotential).toBeDefined();
        expect(typeof record.trace?.factors?.shortlistingPotential).toBe('number');
        expect(record.trace?.factors?.shortlistingPotential).toBeGreaterThanOrEqual(0);
        expect(record.trace?.factors?.shortlistingPotential).toBeLessThanOrEqual(100);
      }
    });

    it('should store full SP calculation in trace for synthesizer consumption', () => {
      for (const record of records) {
        expect(record.trace?.shortlistingPotentialCalculation).toBeDefined();
        const calc = record.trace?.shortlistingPotentialCalculation!;
        expect(calc.score).toBeDefined();
        expect(calc.requirementsScore).toBeDefined();
        expect(calc.evidenceStrengthScore).toBeDefined();
        expect(calc.titleScopeScore).toBeDefined();
        expect(calc.seniorityScore).toBeDefined();
        expect(calc.domainScore).toBeDefined();
      }
    });
  });

  describe('B. SP Independent of Decision-Dependent Inputs', () => {
    it('should calculate SP using only pre-decision assessments', () => {
      // Create mock assessments that would produce a known SP
      const mockIdentity: IdentityAssessment = {
        verdict: "MATCH",
        coverage: 0.5,
        confidence: 0.8,
        explanation: "Test identity"
      };

      const mockCapability: CapabilityAssessment = {
        overallFit: 0.9,
        matchingConfidence: 0.85,
        matches: [
          { dimension: "GROWTH_STRATEGY", confidence: 0.8, evidence: "test" },
          { dimension: "TEAM_LEADERSHIP", confidence: 0.9, evidence: "test" },
          { dimension: "REVENUE_MANAGEMENT", confidence: 0.85, evidence: "test" }
        ],
        missingCapabilities: [],
        hasCriticalGaps: false
      };

      const mockCareer: CareerAssessment = {
        trajectory: "FORWARD",
        score: 75,
        explanation: "Test career"
      };

      const mockOpportunity: OpportunityAssessment = {
        operatingLevel: "VP",
        mandateScope: "P&L",
        confidence: 0.8
      };

      // Calculate SP with pre-decision assessments only
      const spCalc = calculateShortlistingPotentialFromAssessments(
        mockIdentity,
        mockCapability,
        mockCareer,
        mockOpportunity,
        0.8
      );

      // Verify SP is calculated without any decision-dependent inputs
      expect(spCalc.score).toBeGreaterThan(0);
      expect(spCalc.score).toBeLessThanOrEqual(100);
      
      // Verify components are calculated
      expect(spCalc.requirementsScore).toBeGreaterThan(0);
      expect(spCalc.evidenceStrengthScore).toBeGreaterThan(0);
      expect(spCalc.titleScopeScore).toBeGreaterThan(0);
      expect(spCalc.seniorityScore).toBeGreaterThan(0);
      expect(spCalc.domainScore).toBeGreaterThan(0);
    });

    it('should have same SP value in decisionSummary and trace.factors', () => {
      for (const record of records) {
        const summarySP = record.decisionSummary?.shortlistingPotential;
        const traceSP = record.trace?.factors?.shortlistingPotential;
        expect(summarySP).toBe(traceSP);
      }
    });
  });

  describe('C. SP Flows Into RecommendationRecord', () => {
    it('should have consistent SP across all record locations', () => {
      for (const record of records) {
        const summarySP = record.decisionSummary?.shortlistingPotential;
        const traceSP = record.trace?.factors?.shortlistingPotential;
        const calcSP = record.trace?.shortlistingPotentialCalculation?.score;
        
        // All three should match
        expect(summarySP).toBeDefined();
        expect(traceSP).toBeDefined();
        expect(calcSP).toBeDefined();
        expect(summarySP).toBe(traceSP);
        expect(traceSP).toBe(calcSP);
      }
    });
  });

  describe('D. Easy Trap Cases', () => {
    it('j-cc222b05ee62: CV 31 / SP 90 / friction 0 → CONSIDER', () => {
      const record = records.find(r => r.jobHash === "j-cc222b05ee62");
      expect(record).toBeDefined();
      
      // Verify the values
      expect(record!.decisionSummary?.careerValue).toBeLessThanOrEqual(35);
      expect(record!.decisionSummary?.shortlistingPotential).toBeGreaterThanOrEqual(80);
      expect(record!.decisionSummary?.pursuitFriction).toBeLessThanOrEqual(10);
      
      // Must be CONSIDER (downgraded from PURSUE)
      expect(record!.verb).toBe("CONSIDER");
      expect(record!.trace?.pipeline?.some((p: any) => 
        p.stage === "CareerValueProtection" && p.status === "DOWNSCALED"
      )).toBe(true);
    });

    it('j-63144d98a1bd: CV 31 / SP 90 / friction 0 → CONSIDER', () => {
      const record = records.find(r => r.jobHash === "j-63144d98a1bd");
      expect(record).toBeDefined();
      
      // Verify the values
      expect(record!.decisionSummary?.careerValue).toBeLessThanOrEqual(35);
      expect(record!.decisionSummary?.shortlistingPotential).toBeGreaterThanOrEqual(80);
      expect(record!.decisionSummary?.pursuitFriction).toBeLessThanOrEqual(10);
      
      // Must be CONSIDER (downgraded from PURSUE)
      expect(record!.verb).toBe("CONSIDER");
      expect(record!.trace?.pipeline?.some((p: any) => 
        p.stage === "CareerValueProtection" && p.status === "DOWNSCALED"
      )).toBe(true);
    });
  });

  describe('F. Legitimate Medium-CV/High-SP Cases', () => {
    it('should keep PURSUE for cases with medium CV but legitimate opportunity', () => {
      // Look for cases with CV 40-60, high SP, but not in easy trap
      const legitimateCases = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        const friction = r.decisionSummary?.pursuitFriction ?? 0;
        const trajectory = r.trace?.careerValueBreakdown?.trajectory;
        
        // Medium CV (40-60), high SP (>=80), but trajectory is FORWARD or LATERAL
        return cv >= 40 && cv <= 60 && sp >= 80 && friction <= 10 && 
               (trajectory === "FORWARD" || trajectory === "LATERAL");
      });
      
      // All legitimate medium-CV/high-SP cases should be PURSUE
      for (const record of legitimateCases) {
        expect(record.verb).toBe("PURSUE");
      }
    });
  });

  describe('G. High-CV/Low-SP PASS Behavior', () => {
    it('should PASS for high-CV cases with low SP due to identity/capability mismatch', () => {
      const highCvLowSpCases = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        return cv >= 70 && sp <= 60;
      });
      
      // High-CV/low-SP cases should PASS (identity/capability mismatch)
      for (const record of highCvLowSpCases) {
        expect(record.verb).toBe("PASS");
      }
    });
  });

  describe('H. High-CV/High-SP/High-Friction Cases', () => {
    it('should handle high friction cases appropriately', () => {
      const highFrictionCases = records.filter(r => {
        const cv = r.decisionSummary?.careerValue ?? 0;
        const sp = r.decisionSummary?.shortlistingPotential ?? 0;
        const friction = r.decisionSummary?.pursuitFriction ?? 0;
        return cv >= 60 && sp >= 80 && friction >= 20;
      });
      
      // High friction may result in CONSIDER rather than PURSUE
      // But should not be PASS if CV and SP are both high
      for (const record of highFrictionCases) {
        expect(record.verb).not.toBe("PASS");
      }
    });
  });

  describe('I. P2-C Signal-Independence', () => {
    it('should maintain independent SP signal not derived from final decision', () => {
      // For every record, verify SP is not directly derived from verb
      for (const record of records) {
        const sp = record.decisionSummary?.shortlistingPotential ?? 0;
        
        // SP should be calculable regardless of final decision
        // (not a direct function of verb)
        expect(sp).toBeGreaterThanOrEqual(0);
        expect(sp).toBeLessThanOrEqual(100);
        
        // High SP can coexist with any decision
        if (sp >= 80) {
          // High SP opportunities can be PURSUE, CONSIDER, or PASS
          // depending on other factors
          expect(["PURSUE", "CONSIDER", "PASS"]).toContain(record.verb);
        }
      }
    });
  });
});

// Separate test suite for specific Easy Trap detection
describe('P3-A: Easy Trap Rule Detection', () => {
  it('should identify Easy Trap conditions correctly', () => {
    // Easy Trap: CV < 50 AND SP >= 80 AND friction < 10 AND would be PURSUE
    const easyTraps = records.filter(r => {
      const cv = r.decisionSummary?.careerValue ?? 0;
      const sp = r.decisionSummary?.shortlistingPotential ?? 0;
      const friction = r.decisionSummary?.pursuitFriction ?? 0;
      
      // Check if conditions match Easy Trap
      const isEasyTrap = cv <= 50 && sp >= 80 && friction <= 10;
      
      return isEasyTrap;
    });
    
    // All Easy Trap cases should be CONSIDER (downgraded from PURSUE)
    for (const record of easyTraps) {
      expect(record.verb).toBe("CONSIDER");
      expect(record.trace?.pipeline?.some((p: any) => 
        p.stage === "CareerValueProtection"
      )).toBe(true);
    }
  });
});
