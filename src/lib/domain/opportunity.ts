export interface CompanyProfile {
  id: string;
  name: string;
  industry?: string;
  hq?: string;
  size?: string;
  techStack: string[];
  hiringVelocity: number;
  growthSignal?: string;
  updatedAt: string;
}

export interface OpportunityIdentity {
  id: string;
  companyId: string;
  companyName: string;
  canonicalTitle: string;
  location?: string;
  employmentType?: string;
  postingWindow?: string;
  fingerprint: string;
  lifecycle: "DRAFT" | "SHORTLIST" | "ARCHIVED";
  description: string;
  salaryBounds?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  requiredCapabilities: string[]; // Normalized taxonomy keywords
  updatedAt: string;
}
