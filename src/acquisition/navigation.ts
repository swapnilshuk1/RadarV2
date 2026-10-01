import type { AcquisitionFeedState } from "./contracts";

export const acquisitionFeedStates: readonly AcquisitionFeedState[] = [
  "READY",
  "NOT_PURSUED",
  "OUTSIDE_SEARCH",
  "NEEDS_ATTENTION",
  "WAITING",
  "PROCESSING",
  "PREPARING",
];
export interface AcquisitionNavigationSearch {
  offset?: number;
  state?: AcquisitionFeedState;
  tenantId?: string;
  personId?: string;
  canonicalJobId?: string;
  version?: string;
}
export function acquisitionNavigationSearch(
  raw: Record<string, unknown>,
): AcquisitionNavigationSearch {
  const offset = Number(raw.offset);
  return {
    offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
    state: acquisitionFeedStates.includes(raw.state as AcquisitionFeedState)
      ? (raw.state as AcquisitionFeedState)
      : undefined,
    tenantId: typeof raw.tenantId === "string" ? raw.tenantId : undefined,
    personId: typeof raw.personId === "string" ? raw.personId : undefined,
    canonicalJobId: typeof raw.canonicalJobId === "string" ? raw.canonicalJobId : undefined,
    version: typeof raw.version === "string" ? raw.version : undefined,
  };
}
