import { ProjectionPipeline } from "../src/lib/intelligence/pipeline/ProjectionPipeline";
import { getRepositories } from "../src/data/sqlite/provider";

async function runPipelineTest() {
  console.log("=================================================");
  console.log("TESTING PROJECTION PIPELINE (PHASE 6)");
  console.log("=================================================");

  const repos = getRepositories();
  const personId = "swapnil-shukla"; // Existing authenticated user in DB
  const documentId = `doc-test-${Date.now()}`;
  const sampleResume = `
  Swapnil Shukla - Vice President, Growth & Digital Transformation
  Location: Gurugram, India
  Summary: Executive growth leader with 15+ years of experience leading cross-functional teams, driving $50M+ P&L, and managing enterprise MarTech transformations including Salesforce Marketing Cloud (SFMC), GA4, and custom Customer Data Platforms (CDP).
  
  Experience:
  - Vice President, Growth Marketing @ Enterprise Tech (2021 - Present)
    - Led team of 35 growth engineers, product managers, and performance marketers.
    - Scaled annual attributed revenue from $20M to $55M.
    - Spearheaded enterprise migration to Salesforce Marketing Cloud (SFMC) and Google Analytics 4 (GA4).
  - Director of Growth & Digital Strategy @ Global Consumer Brand (2016 - 2021)
    - Managed $12M annual performance marketing budget across APAC and MENA regions.
    - Presented quarterly growth strategy directly to the Board of Directors.
  `;

  const pipeline = new ProjectionPipeline();

  console.log(`Starting pipeline run for document ${documentId}...`);
  const result = await pipeline.run({
    documentId,
    personId,
    filename: "sample_executive_cv.pdf",
    storageUri: "file://.scraper-artifacts/documents/sample_executive_cv.pdf",
    mimeType: "application/pdf",
    documentHash: `hash-${Date.now()}`,
    documentText: sampleResume
  });

  console.log("Pipeline Execution Result:", JSON.stringify(result, null, 2));

  if (!result.success) {
    console.error("Pipeline failed!");
    process.exit(1);
  }

  // Verify DB Persistence
  const doc = await repos.documents.getDocument(documentId);
  console.log("Saved Document Record:", doc?.stage, doc?.status);

  const evGraph = await repos.documents.getEvidenceGraphForDocument(documentId);
  console.log("Extracted Evidence Graph Facts Count:", evGraph?.facts.length);
  console.log("Sample Extracted Facts:", evGraph?.facts.slice(0, 3));

  const latestProjection = await repos.people.getLatestProjection(personId);
  console.log("Saved Candidate Projection Operating Level:", latestProjection?.operatingLevel);
  console.log("Core Capabilities Extracted:", latestProjection?.coreCapabilities);

  console.log("=================================================");
  console.log("PROJECTION PIPELINE TEST SUCCESSFUL!");
  console.log("=================================================");
}

runPipelineTest().catch((err) => {
  console.error("Pipeline test error:", err);
  process.exit(1);
});
