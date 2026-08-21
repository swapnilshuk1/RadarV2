import { DatabaseAdapter } from "@/data/database";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";

export interface DualWritePayload {
  sourcePortal: string;
  sourceJobId: string;
  canonicalUrl: string;
  jobTitle: string;
  companyName: string;
  location: string;
  employmentType: string | null;
  rawContent: string;
}

export async function executeM4ShadowPath(payload: DualWritePayload, customAdapter?: DatabaseAdapter): Promise<void> {
  const service = new CanonicalIngestionService(customAdapter);
  await service.ingestOpportunity({
    sourcePortal: payload.sourcePortal,
    sourceJobId: payload.sourceJobId,
    canonicalUrl: payload.canonicalUrl,
    jobTitle: payload.jobTitle,
    companyName: payload.companyName,
    location: payload.location,
    employmentType: payload.employmentType,
    rawContent: payload.rawContent
  });
}

