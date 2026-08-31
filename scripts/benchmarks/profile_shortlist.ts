import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { getDatabaseAdapter } from "../../src/data/database/index";

async function profileShortlist() {
  const userId = "ms6i7e3y-4x0chy5fy";
  console.log("Starting Shortlist Page Profiling for user:", userId);

  // 1. Profile getFeed / listForUser
  const t0 = performance.now();
  const list = await OpportunityService.listForUser(userId);
  const listMs = performance.now() - t0;
  console.log(`1. OpportunityService.listForUser (24 items): ${listMs.toFixed(2)} ms (Returned: ${list.length} items)`);

  // 2. Profile getMetricsForUser
  const t1 = performance.now();
  const metrics = await OpportunityService.getMetricsForUser(userId);
  const metricsMs = performance.now() - t1;
  console.log(`2. OpportunityService.getMetricsForUser: ${metricsMs.toFixed(2)} ms (Total Screened: ${metrics.totalScreened}, Shortlisted: ${metrics.totalShortlisted})`);

  // 3. Profile getFeedForUser (raw)
  const t2 = performance.now();
  const feed = await OpportunityService.getFeedForUser(userId);
  const feedMs = performance.now() - t2;
  console.log(`3. OpportunityService.getFeedForUser (raw keyset): ${feedMs.toFixed(2)} ms`);

  console.log(`\nTotal Sequential Data Fetch Time: ${(listMs + metricsMs).toFixed(2)} ms`);
  console.log(`Total Parallel Data Fetch Time:   ${Math.max(listMs, metricsMs).toFixed(2)} ms`);
}

profileShortlist().catch(console.error);
