import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/db";
import type { OpportunitySource } from "../../data/opportunity-fixtures";
import type { Extraction } from "../../domain/entities";

export const getOpportunitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  const repos = getRepositories();
  const ops = repos.opportunities.findOpportunities({ status: 'Active' });
  
  const results: OpportunitySource[] = [];
  
  for (const op of ops) {
    const company = (repos as any).companies.findByName((op as any).companyId); // Wait, findById needed? 
    // Actually, we don't have findById on companies yet. We can just use raw sqlite.
    const db = require("../../data/sqlite/db").getDatabase();
    const companyRow = db.prepare("SELECT * FROM companies WHERE id = ?").get(op.companyId) as any;
    
    const listingRow = db.prepare("SELECT * FROM source_listings WHERE opportunity_id = ? LIMIT 1").get(op.id) as any;
    if (!listingRow) continue;
    
    const extractionRow = db.prepare("SELECT * FROM extractions WHERE source_listing_id = ? LIMIT 1").get(listingRow.id) as any;
    
    let dimensions = [];
    if (extractionRow) {
      try {
        const rawJson = JSON.parse(extractionRow.raw_json);
        dimensions = rawJson.dimensions || [];
      } catch (e) {}
    }
    
    results.push({
      jobHash: op.id,
      role: op.canonicalRole,
      company: companyRow ? companyRow.name : "Unknown",
      location: "India", // fallback
      postedRelative: listingRow.posted_at || "Recently",
      scrapedFrom: listingRow.portal,
      applyUrl: listingRow.url,
      dimensions: dimensions,
      primaryConcern: null
    } as any);
  }
  
  return results;
});
