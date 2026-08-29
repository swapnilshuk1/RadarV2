import { describe, it, expect } from 'vitest';
import {
  adaptLegacyEvaluation,
  serveEvaluation,
  type CanonicalIntrinsicEvaluationPayload,
  type CandidateServingContext,
  type OpportunityServingContext
} from '../src/lib/intelligence/serving/EvaluationServingEngine';

const sampleCandCtx: CandidateServingContext = {
  personId: 'person_default',
  attentionWindow: 6,
  activePursuits: 0
};

const sampleOppCtx: OpportunityServingContext = {
  jobHash: 'test_job_123',
  role: 'VP Engineering',
  company: 'TechCorp',
  location: 'Remote',
  scrapedFrom: 'LinkedIn'
};

describe('FOR-3 — Serving Verdict Integrity Suite (No Silent Fallback to CONSIDER)', () => {
  it('1. PASS evaluation yields PASS serving', () => {
    const legacyOpp = { decision: 'PASS', jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.decision).toBe('PASS');
    expect(served.engineRecommendation?.engineVerdict).toBe('PASS');
  });

  it('2. CONSIDER evaluation yields CONSIDER serving', () => {
    const legacyOpp = { decision: 'CONSIDER', jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.decision).toBe('CONSIDER');
    expect(served.engineRecommendation?.engineVerdict).toBe('CONSIDER');
  });

  it('3. PURSUE evaluation yields PURSUE serving', () => {
    const legacyOpp = { decision: 'PURSUE', jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.decision).toBe('PURSUE');
    expect(served.engineRecommendation?.engineVerdict).toBe('PURSUE');
  });

  it('4. SPARSE_SPEC yields SPARSE_SPEC serving', () => {
    const legacyOpp = { decision: 'SPARSE_SPEC', jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('5. NOT_EVALUABLE yields SPARSE_SPEC serving', () => {
    const legacyOpp = { decision: 'NOT_EVALUABLE', jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('6. undefined verdict does NOT silently become CONSIDER (must yield SPARSE_SPEC / NOT_EVALUABLE)', () => {
    const legacyOpp = { decision: undefined, jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).not.toBe('CONSIDER');
    expect(served.engineRecommendation?.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('7. null verdict does NOT silently become CONSIDER', () => {
    const legacyOpp = { decision: null, jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).not.toBe('CONSIDER');
    expect(served.engineRecommendation?.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('8. malformed wrapper does NOT silently become CONSIDER', () => {
    const legacyOpp = { engineRecommendation: { engineVerdict: 'INVALID_VERDICT_STRING' }, jobHash: 'test_job_123' };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).not.toBe('CONSIDER');
    expect(served.engineRecommendation?.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('9. wrapper containing nested evaluation performs correct extraction', () => {
    const legacyOpp = {
      engineRecommendation: {
        engineVerdict: 'PURSUE',
        qualityScore: 88,
        evaluatedAt: '2026-08-20T10:00:00.000Z'
      },
      jobHash: 'test_job_123'
    };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).toBe('PURSUE');
    expect(served.engineRecommendation?.qualityScore).toBe(88);
  });

  it('10. legacy object compatibility performs correct extraction', () => {
    const legacyOpp = {
      recommendationResult: { score: 75 },
      decision: 'CONSIDER',
      jobHash: 'test_job_123'
    };
    const served = adaptLegacyEvaluation(legacyOpp, sampleCandCtx, sampleOppCtx, null);
    expect(served.engineRecommendation?.engineVerdict).toBe('CONSIDER');
    expect(served.engineRecommendation?.qualityScore).toBe(75);
  });

  it('11. real historical PASS record is served as PASS', () => {
    const realHistoricalPassRecord = {
      jobHash: 'j-7d0d312a2c24',
      verb: 'PASS',
      rawScore: 0.15,
      engineVersion: 'v4.1'
    };
    const served = adaptLegacyEvaluation(realHistoricalPassRecord, sampleCandCtx, sampleOppCtx, null);
    expect(served.decision).toBe('PASS');
    expect(served.engineRecommendation?.engineVerdict).toBe('PASS');
  });
});
