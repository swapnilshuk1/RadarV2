export type SourceCapability = "Search" | "Listing" | "Detail" | "CompanySite" | "Authentication" | "RateLimits";

export interface AcquisitionSource {
  id: string;
  name: string;
  type: "JobBoard" | "CompanySite" | "ExecutiveFirm" | "Network";
  capabilities: SourceCapability[];
  status: "active" | "deprecated" | "broken";
  createdAt?: string;
}
