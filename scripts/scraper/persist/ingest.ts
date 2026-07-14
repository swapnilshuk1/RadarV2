import { getRepositories } from "../../../src/data/sqlite/db";
import type { DetailedCard } from "../types";
import { randomUUID } from "crypto";
import type { Company, Opportunity, SourceListing, Extraction } from "../../../src/domain/entities";

export function ingestIntoSqlite(card: DetailedCard, extractionJson: string, extractorVersion: string) {
  const repos = getRepositories();

  // 1. Company
  const companyName = card.metadata?.originalCompany || "Unknown Company";
  let company = repos.companies.findByName(companyName);
  
  if (!company) {
    company = {
      id: "c_" + randomUUID(),
      name: companyName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _meta: { schemaVersion: "1.0" }
    };
    repos.companies.registerCompany(company);
  }

  // 2. Opportunity
  const roleName = card.metadata?.originalTitle || "Unknown Role";
  // Check if opportunity exists for this company + role
  let ops = repos.opportunities.findOpportunities({ status: 'Active' });
  let opportunity = ops.find(o => o.companyId === company!.id && o.canonicalRole === roleName);

  if (!opportunity) {
    opportunity = {
      id: "o_" + randomUUID(),
      companyId: company.id,
      canonicalRole: roleName,
      status: "Active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _meta: { schemaVersion: "1.0" }
    };
    repos.opportunities.mergeOpportunity(opportunity);
  }

  // 3. SourceListing
  const listing: SourceListing = {
    id: "l_" + randomUUID(),
    opportunityId: opportunity.id,
    portal: card.portal,
    url: card.url,
    postedAt: card.metadata?.postedAt,
    recruiter: card.metadata?.recruiterName,
    salaryMetadata: card.metadata?.salary,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _meta: { schemaVersion: "1.0" }
  };
  repos.opportunities.recordListing(listing);

  // 4. Extraction
  const extraction: Extraction = {
    id: "ex_" + randomUUID(),
    sourceListingId: listing.id,
    rawJson: extractionJson,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _meta: { schemaVersion: "1.0", extractorVersion }
  };
  repos.acquisition.recordExtraction(extraction);
  
  // NOTE: In Sprint 2, we stop here for the acquisition phase.
  // The Reasoning Engine (Sprint 2.5) will parse `extraction.rawJson` into 
  // Evidence, Facts, Claims, and InferenceGraphs.
}
