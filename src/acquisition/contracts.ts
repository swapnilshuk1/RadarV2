export type AcquisitionFeedState =
  | "NOT_PURSUED"
  | "READY"
  | "PREPARING"
  | "PROCESSING"
  | "WAITING"
  | "NEEDS_ATTENTION"
  | "OUTSIDE_SEARCH";

export interface AcquisitionFeedRow {
  id: string;
  version: string;
  jobHash: string;
  role: string;
  company: string;
  location: string;
  source: string;
  state: AcquisitionFeedState;
  decision: string | null;
}
