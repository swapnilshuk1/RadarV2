
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { BriefCompositionEngine } from '../../src/lib/intelligence/editorial/BriefCompositionEngine';
import { OpportunityBriefView } from '../../src/routes/opportunity.$jobHash';
import { Route } from '../../src/routes/opportunity.$jobHash';

let mockLoaderData: any = {};
vi.mock('../../src/routes/opportunity.$jobHash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/routes/opportunity.$jobHash')>();
  return {
    ...actual,
    Route: {
      useLoaderData: () => mockLoaderData,
    }
  };
});

vi.mock('../../src/lib/decisions-store', () => ({
  useDecisions: () => ({ decisions: {}, decide: vi.fn() })
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  createFileRoute: () => () => ({ 
    component: () => null,
    useLoaderData: () => mockLoaderData
  }),
  notFound: () => new Error('Not found'),
  Link: () => null
}));

const mockCompose = vi.spyOn(BriefCompositionEngine, 'compose').mockReturnValue({} as any);

describe('Test F: Editorial Boundary (BriefCompositionEngine)', () => {
  beforeEach(() => {
    mockCompose.mockClear();
  });

  it('bypasses editorial composition for UnmaterializedOpportunity', () => {
    mockLoaderData = {
      opportunity: {
        evaluationState: 'UNMATERIALIZED',
        jobHash: 'hash-1',
        role: 'CEO',
        company: 'Company A'
      },
      neighbors: { prev: undefined, next: undefined },
      currentIndex: 1,
      totalCount: 1
    };

    const result = OpportunityBriefView();
    
    // Engine should NOT be invoked
    expect(mockCompose).not.toHaveBeenCalled();
    // Component should return the fallback JSX
    expect(result).toBeDefined();
  });

  it('bypasses editorial composition for UnavailableOpportunity', () => {
    mockLoaderData = {
      opportunity: {
        evaluationState: 'SPARSE_SPEC',
        jobHash: 'hash-2',
        role: 'CTO',
        company: 'Company B'
      },
      neighbors: { prev: undefined, next: undefined },
      currentIndex: 1,
      totalCount: 1
    };

    const result = OpportunityBriefView();
    expect(mockCompose).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('invokes editorial composition for EvaluatedOpportunity', () => {
    mockLoaderData = {
      opportunity: {
        evaluationState: 'EVALUATED',
        jobHash: 'hash-3',
        role: 'CFO',
        company: 'Company C',
        decision: 'PURSUE',
        recommendation: 'Good',
        positioning: [],
        headspace: [],
        dimensions: []
      },
      neighbors: { prev: undefined, next: undefined },
      currentIndex: 1,
      totalCount: 1
    };

    const result = OpportunityBriefView();
    expect(mockCompose).toHaveBeenCalled();
  });
});
