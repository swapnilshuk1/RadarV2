import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./services/OpportunityService";
import type { OpportunitySource } from "../../data/opportunity-fixtures";
import { getDatabase } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";

export const getOpportunitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuthUser();
  const service = new OpportunityService();
  const ops = await service.getActiveOpportunities();
  
  const results: any[] = [];
  const db = getDatabase();
  
  for (const op of ops) {
    const companyRow = await db.one<any>("SELECT * FROM companies WHERE id = ?", [op.companyId]);
    const documentRow = await db.one<any>("SELECT * FROM documents WHERE opportunity_id = ? LIMIT 1", [op.id]);
    
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
    const user = await requireAuthUser();
    if (data.personId !== user.id && user.role !== "admin") {
      const error: any = new Error("FORBIDDEN: Opportunity explanation access denied");
      error.statusCode = 403;
      throw error;
    }
    const service = new OpportunityService();
    const explanation = await service.explainOpportunity(data.opportunityId, data.personId);
    
    if (!explanation) {
      throw new Error("Explanation not found or incomplete reasoning chain");
    }

    return explanation;
  });
