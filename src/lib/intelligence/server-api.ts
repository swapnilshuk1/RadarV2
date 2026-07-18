import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./services/OpportunityService";
import type { OpportunitySource } from "../../data/opportunity-fixtures";
import { getDatabase } from "../../data/sqlite/provider";

export const getOpportunitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  const service = new OpportunityService();
  const ops = service.getActiveOpportunities();
  
  const results: any[] = [];
  
  // HACK: Fallback to SQLite raw queries for Company name and Document dimensions 
  // until we build the full UI models.
  const db = getDatabase();
  
  for (const op of ops) {
    const companyRow = db.prepare("SELECT * FROM companies WHERE id = ?").get(op.companyId) as any;
    const documentRow = db.prepare("SELECT * FROM documents WHERE opportunity_id = ? LIMIT 1").get(op.id) as any;
    
    let dimensions = [];
    if (documentRow && documentRow.payload_type === "Structured") {
      try {
        const rawJson = JSON.parse(documentRow.content);
        dimensions = rawJson.dimensions || [];
      } catch (e) {}
    }
    
    results.push({
      jobHash: op.id,
      role: op.canonicalTitle,
      company: companyRow ? companyRow.name : "Unknown",
      location: op.location || "Unknown",
      postedRelative: op.postingWindow || "Recently",
      scrapedFrom: "Careers",
      applyUrl: "", 
      dimensions: dimensions,
      primaryConcern: null
    });
  }
  
  return results as OpportunitySource[];
});

export const explainOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: { opportunityId: string, personId: string }) => d)
  .handler(async ({ data }) => {
    const service = new OpportunityService();
    const explanation = service.explainOpportunity(data.opportunityId, data.personId);
    
    if (!explanation) {
      throw new Error("Explanation not found or incomplete reasoning chain");
    }

    return explanation;
  });
