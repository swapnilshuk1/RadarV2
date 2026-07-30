import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { getRepositories } from "../src/data/sqlite/provider";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import fs from "fs";

async function main() {
  const repos = getRepositories();
  const userId = "swapnil-shukla";
  const projection = await repos.people.getLatestProjection(userId);
  
  if (!projection) {
    console.error("No projection found for user", userId);
    return;
  }

  const { records, presented } = runEngine(projection, 0);
  const opps = readOpportunities();

  const pursueTarget = 5;
  const considerTarget = 3;
  const passTarget = 2;

  let pursueFound = 0;
  let considerFound = 0;
  let passFound = 0;

  const selectedJobs = [];
  const edgeCaseJobHashes = ["a6b222956cf9e3dc2b80cd63fc234bb4"];

  const shuffledRecords = [...records].sort(() => 0.5 - Math.random());

  for (const rec of shuffledRecords) {
    let include = false;
    const jobHash = (rec as any).jobHash || (rec as any).opportunityId || (rec as any).opportunity?.jobHash;
    if (edgeCaseJobHashes.includes(jobHash)) {
      include = true;
    } else if (rec.verb === "PURSUE" && pursueFound < pursueTarget) {
      pursueFound++;
      include = true;
    } else if (rec.verb === "CONSIDER" && considerFound < considerTarget) {
      considerFound++;
      include = true;
    } else if (rec.verb === "PASS" && passFound < passTarget) {
      passFound++;
      include = true;
    }

    if (include) {
      const raw = opps.find(o => o.jobHash === jobHash || o.id === jobHash);
      const jobProjV4 = raw ? JobProjectionBuilder.build(raw) : null;
      const presentedOpp = presented.find(p => p.opportunity.jobHash === jobHash)?.opportunity;

      selectedJobs.push({
        record: rec as any,
        rawOpportunity: raw,
        jobProjection: jobProjV4,
        presentedOpp
      });
    }
  }

  const chunks = [];
  chunks.push("# Decision Engine Architectural Dataset");
  chunks.push("> **Purpose**: This dataset exposes the complete internal pipeline, reasoning trace, and semantic mappings for qualitative architectural review. It bypasses abstract metrics in favor of explicit decision drivers and structured trace stages.");
  
  selectedJobs.forEach((item, idx) => {
    const rec = item.record;
    const raw = item.rawOpportunity || {};
    const proj = item.jobProjection || {};
    const pres = item.presentedOpp || raw;
    
    const role = raw.role || raw.canonicalTitle || pres.role || "Unknown Role";
    const company = raw.company || pres.company || "Unknown Company";
    const fullText = raw.description || raw.normalizedText || raw.rawText || "No full text available";

    let brief = null;
    try {
      if (pres && pres.dimensions) {
        brief = BriefCompositionEngine.compose(pres);
      }
    } catch (e) {
      // Fallback
    }
    
    chunks.push(`\n\n## Job ${idx + 1}: ${role} @ ${company} [${rec.verb}]`);
    
    chunks.push("\n================================================");
    chunks.push("### 1. Raw Job");
    chunks.push("================================================\n");
    chunks.push("<details>\n<summary>Click to expand unedited raw text</summary>\n");
    chunks.push(`\`\`\`text\n${fullText}\n\`\`\``);
    chunks.push("</details>");

    chunks.push("\n================================================");
    chunks.push("### 2. Candidate Projection");
    chunks.push("================================================\n");
    chunks.push("```json\n" + JSON.stringify(projection, null, 2) + "\n```");

    chunks.push("\n================================================");
    chunks.push("### 3. Job Projection");
    chunks.push("================================================\n");
    chunks.push("```json\n" + JSON.stringify({
      role: proj.role || role,
      executiveIdentity: proj.executiveIdentity || {},
      operatingLevel: proj.operatingLevel || "UNKNOWN",
      workNature: proj.workNature || "UNKNOWN",
      commercialScope: proj.commercialScope || "UNKNOWN",
      decisionAuthority: proj.decisionAuthority || "UNKNOWN",
      capabilities: proj.capabilities || [],
      executiveFunction: proj.executiveFunction || [],
      businessObjectives: proj.businessObjectives || [],
      executionStyle: proj.executionStyle || [],
      operatingContext: proj.operatingContext || {},
      capabilityExtractionStatus: proj.capabilityExtractionStatus || "COMPLETE"
    }, null, 2) + "\n```");

    chunks.push("\n================================================");
    chunks.push("### 4. Decision Pipeline");
    chunks.push("================================================\n");
    chunks.push("```json\n" + JSON.stringify(rec.trace?.pipeline || [], null, 2) + "\n```");

    chunks.push("\n================================================");
    chunks.push("### 5. Decision Drivers");
    chunks.push("================================================\n");
    chunks.push("**Drivers (Positive)**:");
    chunks.push("```json\n" + JSON.stringify(rec.decisionDrivers || [], null, 2) + "\n```");
    chunks.push("**Risks (Negative)**:");
    chunks.push("```json\n" + JSON.stringify(rec.decisionRisks || [], null, 2) + "\n```");
    chunks.push("**Decision Summary** (Metrics):");
    chunks.push("```json\n" + JSON.stringify(rec.decisionSummary || {}, null, 2) + "\n```");
    chunks.push("**Career Value Breakdown**:");
    chunks.push("```json\n" + JSON.stringify(rec.trace?.careerValueBreakdown || {}, null, 2) + "\n```");
    chunks.push(`**Confidences**: Parsing: ${rec.confidences?.parsing}, Matching: ${rec.confidences?.matching}, Recommendation: ${rec.confidences?.recommendation}`);

    chunks.push("\n================================================");
    chunks.push("### 6. Evidence Mapping");
    chunks.push("================================================\n");
    chunks.push("```json\n" + JSON.stringify({ matches: rec.trace?.evidenceMapping || [] }, null, 2) + "\n```");

    chunks.push("\n================================================");
    chunks.push("### 7. Final Editorial Output");
    chunks.push("================================================\n");
    chunks.push("**Queue Presentation (Inline Brief)**");
    chunks.push(`* **Identity**: ${role}`);
    chunks.push(`* **Context**: ${company} • ${raw.location || "Unknown"}`);
    chunks.push(`* **Recall Cue**: ${brief?.headline || brief?.memory?.headline || "N/A"}`);
    chunks.push(`* **Expanded Driver**: ${brief?.memory?.primaryOpportunity || "N/A"}`);
    chunks.push(`* **Expanded Risk**: ${brief?.memory?.primaryRisk || "N/A"}`);
    chunks.push(`* **Recommendation**: ${brief?.memory?.recommendedAction || rec.verb}`);
    chunks.push("**Full Memorandum (Advisory Dossier)**");
    chunks.push(`* **Retention Sentence**: ${brief?.memory?.retentionSentence || "N/A"}`);
    chunks.push(`* **Tradeoff**: ${brief?.memory?.tradeoff || "N/A"}`);
    chunks.push(`* **First 90 Days**: ${brief?.memory?.first90Days || "N/A"}`);
    chunks.push(`* **Why Now**: ${brief?.memory?.whyNow || "N/A"}`);
    chunks.push("\n---");
  });

  const outPath = "C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff/decision_examples.md";
  fs.writeFileSync(outPath, chunks.join("\n"));
  console.log("Successfully wrote to", outPath);
}

main().catch(console.error);

