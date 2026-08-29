import { OpportunityService } from "../src/lib/intelligence/opportunity-service.js";

async function main() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const metrics = await OpportunityService.getMetricsForUser(userId);
  console.log("=== REMOTE METRICS FOR ms6i7e3y-4x0chy5fy ===");
  console.log(metrics);
  const ops = await OpportunityService.listForUser(userId);
  console.log("ops.length:", ops.length);
}

main().catch(console.error);
