export interface CatalogVersion {
  id: string;
  versionString: string;
  createdAt?: string;
}

export interface AcquisitionCampaign {
  id: string;
  name: string;
  createdAt?: string;
}

export interface AcquisitionStrategy {
  id: string;
  campaignId: string;
  catalogVersionId: string;
  name: string;
  freshnessTargetDays: number;
  createdAt?: string;
}

export interface AcquisitionBudget {
  id: string;
  strategyId: string;
  maxMinutes?: number;
  maxPages?: number;
  maxDetailFetches?: number;
  maxBrowserSessions?: number;
  maxLlmTokens?: number;
  maxUsd?: number;
  createdAt?: string;
}

export interface SearchFamily {
  id: string;
  strategyId: string;
  name: string;
  weight: number;
  createdAt?: string;
}

export interface SearchIntent {
  id: string;
  familyId: string;
  name: string;
  createdAt?: string;
}

export interface QueryTemplate {
  id: string;
  intentId: string;
  template: string; // e.g., "{{intent}} in {{location}}"
  createdAt?: string;
}

/**
 * SearchDefinition is an IMMUTABLE executable query.
 * If any property changes, a new definition ID must be generated.
 */
export interface SearchDefinition {
  id: string;
  intentId: string;
  portal: string;
  location?: string;
  industry?: string;
  isRemote: boolean;
  query: string;
  status: "ACTIVE" | "PAUSED" | "RETIRED" | "EXPERIMENTAL";
  maturity: "Experimental" | "Candidate" | "Stable" | "Core";
  priority: number;
  createdAt?: string;
}
