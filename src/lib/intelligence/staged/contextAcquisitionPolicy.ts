/** Immutable semantic recipe. Any change requires a new staged policy version. */
export const CONTEXT_ACQUISITION_POLICY = {
  version: 'context-acquisition-v2',
  searchProvider: 'tavily', searchDepth: 'advanced', maxResults: 5,
  querySuffix: 'company financial results leadership funding workforce growth market expansion',
  maxSourceCharacters: 40_000, websiteDiscoveryVersion: 'company-website-v2',
  relevanceSelectionVersion: 'exact-employer-v1', ledgerVersion: 'retrieval-not-resolution-v2',
  failurePolicy: 'require-operational-search-before-freezing',
  candidateConflictPolicy: 'propagate-unresolved-conflicts-v2',
} as const;
