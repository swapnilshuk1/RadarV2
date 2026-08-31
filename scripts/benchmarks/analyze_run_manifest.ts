import * as fs from "fs";
import * as path from "path";

function analyzeManifest() {
  const manifestPath = path.resolve(
    process.cwd(),
    ".scraper-artifacts/runs/run-1788182498220/manifest.json"
  );
  const journalPath = path.resolve(
    process.cwd(),
    ".scraper-artifacts/runs/run-1788182498220/journal.ndjson"
  );

  console.log("Reading manifest.json...");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  console.log("Manifest keys:", Object.keys(manifest));
  console.log("Status:", manifest.status);
  console.log("Run ID:", manifest.runId);
  if (manifest.summary) {
    console.log("Summary:", JSON.stringify(manifest.summary, null, 2));
  }

  // Check opportunities / cards / work units in manifest
  if (manifest.novelOpportunities) {
    console.log(`novelOpportunities count: ${manifest.novelOpportunities.length}`);
  }
  if (manifest.discoveredJobs) {
    console.log(`discoveredJobs count: ${manifest.discoveredJobs.length}`);
  }
  if (manifest.acquiredJobs) {
    console.log(`acquiredJobs count: ${manifest.acquiredJobs.length}`);
  }

  console.log("\nReading journal.ndjson...");
  const journalLines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);
  console.log(`Total journal events: ${journalLines.length}`);

  const eventTypes: Record<string, number> = {};
  const ingestedEvents: any[] = [];
  const enrichmentEvents: any[] = [];

  for (const line of journalLines) {
    try {
      const ev = JSON.parse(line);
      eventTypes[ev.type || ev.event || "unknown"] = (eventTypes[ev.type || ev.event || "unknown"] || 0) + 1;
      if (ev.type?.includes("ingest") || ev.event?.includes("ingest") || ev.action?.includes("ingest")) {
        ingestedEvents.push(ev);
      }
      if (ev.type?.includes("enrich") || ev.event?.includes("enrich") || ev.action?.includes("enrich") || line.includes("ATS")) {
        enrichmentEvents.push(ev);
      }
    } catch (e) {}
  }

  console.log("Journal Event Types:", JSON.stringify(eventTypes, null, 2));
  console.log(`Ingested events: ${ingestedEvents.length}`);
  console.log(`Enrichment events: ${enrichmentEvents.length}`);

  if (ingestedEvents.length > 0) {
    console.log("Sample Ingested Event:", JSON.stringify(ingestedEvents[0], null, 2));
  }
  if (enrichmentEvents.length > 0) {
    console.log("Sample Enrichment Event:", JSON.stringify(enrichmentEvents[0], null, 2));
  }
}

analyzeManifest();
