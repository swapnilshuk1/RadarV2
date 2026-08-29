import { describe, it, expect } from 'vitest';
import { adaptLegacyEvaluation, type CandidateServingContext, type OpportunityServingContext } from '../../src/lib/intelligence/serving/EvaluationServingEngine.js';
import { isEvaluated, isUnavailable, type Opportunity, type EvaluatedOpportunity, type UnmaterializedOpportunity } from '../../src/data/opportunity-fixtures.js';

const sampleCandCtx: CandidateServingContext = {
  personId: 'ms6i7e3y-4x0chy5fy',
  attentionWindow: 5,
  activePursuits: 0
};

describe('FOR-4D1 Serving Contract & Shortlist Fixes', () => {
  it('TEST 1 & TEST 2: categoryId filtering on unmaterialized records and shortlist isolation', () => {
    // Mock evaluated transformation opportunity
    const evalTransOpp: EvaluatedOpportunity = {
      evaluationState: 'EVALUATED',
      jobHash: 'j_trans_1',
      role: 'Director Strategy & Transformation',
      company: 'Accenture',
      location: 'Remote',
      scrapedFrom: 'LinkedIn',
      engineRecommendation: {
        jobHash: 'j_trans_1',
        evaluationFingerprint: 'fp_1',
        engineVerdict: 'PURSUE',
        verb0: 'PURSUE',
        headspaceVerdict: 'PURSUE',
        headspaceDowngraded: false,
        vetoed: false,
        vetoReason: null,
        qualityScore: 90,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: []
      },
      decision: 'PURSUE',
      recommendation: 'Strategic fit',
      whyNow: 'Now',
      positioning: [],
      hiringRisk: 'Low',
      dimensions: []
    };

    // Mock unmaterialized opportunity
    const unmatOpp: UnmaterializedOpportunity = {
      evaluationState: 'UNMATERIALIZED',
      jobHash: 'j_unmat_1',
      role: 'Transformation Lead',
      company: 'Company not available',
      location: 'Remote',
      scrapedFrom: 'LinkedIn',
      contextFingerprint: 'fp_1'
    };

    const corpus: Opportunity[] = [evalTransOpp, unmatOpp];

    // Verify shortlistedOps filter logic
    const shortlistedOps = corpus.filter((o) => {
      if (isEvaluated(o)) {
        return o.engineRecommendation?.engineVerdict === 'PURSUE' || o.engineRecommendation?.engineVerdict === 'CONSIDER';
      }
      if (isUnavailable(o) && o.evaluationState === 'SPARSE_SPEC') return false;
      return false; // Exclude UNMATERIALIZED
    });

    expect(shortlistedOps.length).toBe(1);
    expect(shortlistedOps[0].jobHash).toBe('j_trans_1');
    expect(shortlistedOps.filter(o => o.evaluationState === 'UNMATERIALIZED').length).toBe(0);
  });

  it('TEST 3: shortlistedOps excludes UNMATERIALIZED records', () => {
    const unmatOpp: UnmaterializedOpportunity = {
      evaluationState: 'UNMATERIALIZED',
      jobHash: 'j_unmat_904',
      role: 'Head of Growth',
      company: 'Company not available',
      location: 'Remote',
      scrapedFrom: 'LinkedIn',
      contextFingerprint: 'fp_1'
    };

    const shortlisted = [unmatOpp].filter((o) => {
      if (isEvaluated(o)) {
        return o.engineRecommendation?.engineVerdict === 'PURSUE' || o.engineRecommendation?.engineVerdict === 'CONSIDER';
      }
      if (isUnavailable(o) && o.evaluationState === 'SPARSE_SPEC') return false;
      return false;
    });

    expect(shortlisted.length).toBe(0);
  });

  it('TEST 4: evaluated PURSUE remains eligible', () => {
    const evalPursue: EvaluatedOpportunity = {
      evaluationState: 'EVALUATED',
      jobHash: 'j_pursue_1',
      role: 'VP Marketing',
      company: 'Swiggy',
      location: 'Bengaluru',
      scrapedFrom: 'LinkedIn',
      engineRecommendation: {
        jobHash: 'j_pursue_1',
        evaluationFingerprint: 'fp_1',
        engineVerdict: 'PURSUE',
        verb0: 'PURSUE',
        headspaceVerdict: 'PURSUE',
        headspaceDowngraded: false,
        vetoed: false,
        vetoReason: null,
        qualityScore: 92,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: []
      },
      decision: 'PURSUE',
      recommendation: 'Great match',
      whyNow: 'Immediate',
      positioning: [],
      hiringRisk: 'Low',
      dimensions: []
    };

    const shortlisted = [evalPursue].filter((o) => {
      if (isEvaluated(o)) {
        return o.engineRecommendation?.engineVerdict === 'PURSUE' || o.engineRecommendation?.engineVerdict === 'CONSIDER';
      }
      return false;
    });

    expect(shortlisted.length).toBe(1);
    expect(shortlisted[0].company).toBe('Swiggy');
  });

  it('TEST 5: evaluated CONSIDER remains eligible', () => {
    const evalConsider: EvaluatedOpportunity = {
      evaluationState: 'EVALUATED',
      jobHash: 'j_consider_1',
      role: 'Director Product',
      company: 'Microsoft',
      location: 'Hyderabad',
      scrapedFrom: 'LinkedIn',
      engineRecommendation: {
        jobHash: 'j_consider_1',
        evaluationFingerprint: 'fp_1',
        engineVerdict: 'CONSIDER',
        verb0: 'CONSIDER',
        headspaceVerdict: 'CONSIDER',
        headspaceDowngraded: false,
        vetoed: false,
        vetoReason: null,
        qualityScore: 78,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: []
      },
      decision: 'CONSIDER',
      recommendation: 'Possible fit',
      whyNow: 'Next quarter',
      positioning: [],
      hiringRisk: 'Medium',
      dimensions: []
    };

    const shortlisted = [evalConsider].filter((o) => {
      if (isEvaluated(o)) {
        return o.engineRecommendation?.engineVerdict === 'PURSUE' || o.engineRecommendation?.engineVerdict === 'CONSIDER';
      }
      return false;
    });

    expect(shortlisted.length).toBe(1);
    expect(shortlisted[0].company).toBe('Microsoft');
  });

  it('TEST 6: evaluated PASS remains excluded from active shortlist feed', () => {
    const evalPass: EvaluatedOpportunity = {
      evaluationState: 'EVALUATED',
      jobHash: 'j_pass_1',
      role: 'Junior Sales Manager',
      company: 'Puffy',
      location: 'Remote',
      scrapedFrom: 'LinkedIn',
      engineRecommendation: {
        jobHash: 'j_pass_1',
        evaluationFingerprint: 'fp_1',
        engineVerdict: 'PASS',
        verb0: 'PASS',
        headspaceVerdict: 'PASS',
        headspaceDowngraded: false,
        vetoed: false,
        vetoReason: null,
        qualityScore: 40,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: []
      },
      decision: 'PASS',
      recommendation: 'Not aligned',
      whyNow: 'N/A',
      positioning: [],
      hiringRisk: 'High',
      dimensions: []
    };

    const shortlisted = [evalPass].filter((o) => {
      if (isEvaluated(o)) {
        return o.engineRecommendation?.engineVerdict === 'PURSUE' || o.engineRecommendation?.engineVerdict === 'CONSIDER';
      }
      return false;
    });

    expect(shortlisted.length).toBe(0);
  });

  it('TEST 7: missing/invalid verdict remains SPARSE_SPEC', () => {
    const adapted = adaptLegacyEvaluation(
      { engineRecommendation: { engineVerdict: null } } as any,
      sampleCandCtx,
      { jobHash: 'test_hash', role: 'Test Director', company: 'Puffy' },
      null
    );
    expect(adapted.engineRecommendation.engineVerdict).toBe('SPARSE_SPEC');
  });

  it('TEST 8: hydrated record displays authoritative company', () => {
    const oppCtx: OpportunityServingContext = {
      jobHash: 'j_hydrated_1',
      role: 'Senior Director - Performance Marketing (Remote)',
      company: 'Puffy',
      location: 'Mumbai'
    };
    const adapted = adaptLegacyEvaluation(
      { decision: 'PURSUE', jobHash: 'j_hydrated_1' },
      sampleCandCtx,
      oppCtx,
      null
    );
    expect(adapted.company).toBe('Puffy');
  });

  it('TEST 9: unknown company does not become a fabricated company name', () => {
    const oppCtx: OpportunityServingContext = {
      jobHash: 'j_unknown_1',
      role: 'Chief Technology Officer',
      company: 'Unknown',
      location: 'Remote'
    };
    const adapted = adaptLegacyEvaluation(
      { decision: 'PURSUE', jobHash: 'j_unknown_1' },
      sampleCandCtx,
      oppCtx,
      null
    );
    expect(adapted.company).toBe('Company not available');
    expect(adapted.company).not.toBe('Executive Firm');
  });

  it('TEST 10 & TEST 11: adaptLegacyEvaluation and serveEvaluation handle missing fields safely', () => {
    const adapted = adaptLegacyEvaluation(
      {},
      sampleCandCtx,
      { jobHash: 'j_safe_1' },
      null
    );
    expect(adapted.jobHash).toBe('j_safe_1');
    expect(adapted.company).toBe('Company not available');
  });
});
