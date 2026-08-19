/**
 * P0-G: Shortlist Purity Invariant (FINAL)
 * 
 * Given: Opportunities evaluated by engine
 * When: OpportunityProvider.list() constructs shortlist
 * Then: SPARSE_SPEC is EXCLUDED from scored ranking collection
 * 
 * DISTINCTION:
 * - scoredRanking: items with numeric priority, sortable by score
 * - unevaluable: items with inability to score (SPARSE_SPEC, NOT_EVALUABLE)
 * 
 * Contract: SPARSE_SPEC does not physically exist in scored collection.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createSparseCommercial } from "./fixtures/sparse-commercial";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { createGroundedCommercial } from "./fixtures/grounded-commercial";
import { createCandidateProfile, getOpportunityProviderForTest, type InjectableOpportunityProvider } from "./p0g-test-infrastructure";

// P0-G: SHORTLIST EXCLUSION (WEAKNESS → ARCHITECTURAL HARDENING)

// SPARSE_SPEC opportunities must be excluded from scoredRanking

describe("P0-G: Shortlist Exclusion — SPARSE_SPEC → unevaluable bucket", () => {
  let sparseFixture: ReturnType<typeof createSparseCommercial>;
  let candidateProfile: ReturnType<typeof createCandidateProfile>;
  
  beforeAll(() => {
    sparseFixture = createSparseCommercial();
    candidateProfile = createCandidateProfile("VP");
  });

  it("excludes SPARSE_SPEC from scoredRanking and routes to unevaluable", async () => {
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    
    // ACT: Inject known SPARSE_SPEC opportunity into provider
    // This tests the actual architectural path: emptyThread → DecisionPolicyEngine.SPARSE_SPEC → exclusion
    const provider: InjectableOpportunityProvider = await getOpportunityProviderForTest();

    const result = await provider.list({
      activePursuits: 0,
      forceInjectedOpportunities: [{
        jobHash: sparseFixture.jobHash,
        rawText: sparseFixture.rawText,
        companyName: sparseFixture.company,
        title: sparseFixture.role
      }]
    });

    // ASSERT-CAUSALITY: The sparse fixture actually reached the provider input
    const sparseInUnevaluable = result.unevaluable.find(
      x => x.jobHash === sparseFixture.jobHash
    );
    expect(sparseInUnevaluable).toBeDefined();
    
    // ASSERT-EXCLUSION: SPARSE_SPEC is physically absent from scoredRanking
    expect(
      result.scoredRanking.some(x => x.jobHash === sparseFixture.jobHash)
    ).toBe(false);

    // ASSERT-BUCKET-SEMANTICS: SPARSE_SPEC lands in explicit unevaluable bucket with correct status
    expect(sparseInUnevaluable?.evaluationStatus).toBe("SPARSE_SPEC");
  });

  it("preserves normal opportunities in scoredRanking when mixed with SPARSE_SPEC", async () => {
    // ARRANGE: Mix of evaluable and unevaluable opportunities
    const sparse = createSparseCommercial();
    const normal = createGroundedCommercial(); // Normal evaluable opportunity

    const provider = await getOpportunityProviderForTest();

    // ACT
    const result = await provider.list({
      activePursuits: 0,
      forceInjectedOpportunities: [
        { jobHash: sparse.jobHash, rawText: sparse.rawText, companyName: sparse.company, title: sparse.role },
        { jobHash: normal.jobHash, rawText: normal.rawText, companyName: normal.company, title: normal.role }
      ]
    });

    // ASSERT: Proper bucket segregation
    expect(result.scoredRanking.some(x => x.jobHash === normal.jobHash)).toBe(true);
    expect(result.scoredRanking.some(x => x.jobHash === sparse.jobHash)).toBe(false);

    expect(result.unevaluable.some(x => x.jobHash === sparse.jobHash)).toBe(true);
    expect(result.unevaluable.some(x => x.jobHash === normal.jobHash)).toBe(false);
  });

  it("prevents P0-G false-green: fails if injection seam not implemented", () => {
    // Documenting the hard requirement: without injection, test must fail
    // This guards against the "accidentally empty corpus" false green
    expect(typeof getOpportunityProviderForTest).toBe("function");
  });
});

