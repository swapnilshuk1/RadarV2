import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { getRepositories } from "../src/data/sqlite/provider";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import { extraOpportunities } from "../src/data/extra-fixtures";
import fs from "fs";

// 20 Distinct Real Executive Job Profiles
const test20Jobs = [
  // 1. DaMENSCH Head of Growth
  {
    jobHash: "j-008f74870e2a",
    role: "Head of Growth",
    company: "DaMENSCH",
    location: "Bengaluru · India",
    description: "DaMENSCH is looking for a Head of Growth to scale D2C acquisition, performance marketing budget ($12M), CRM, RevOps, and customer analytics. Own the P&L and report to CGO."
  },
  // 2. BMW India Director Sales
  rawOpportunities[0],
  // 3. Reliance Retail VP E-Commerce
  rawOpportunities[1],
  // 4. VML Executive Strategy Director
  rawOpportunities[2],
  // 5. Maruti Suzuki Senior Director Marketing
  extraOpportunities[0],
  // 6. Zomato VP Growth
  extraOpportunities[1],
  // 7. Landmark Group CMO
  extraOpportunities[2],
  // 8. Freshworks CGO
  extraOpportunities[3],
  // 9. Nykaa Head of Performance Marketing
  {
    jobHash: "j-nykaa-head-perf",
    role: "Head of Performance Marketing",
    company: "Nykaa",
    location: "Mumbai · India",
    description: "Nykaa is hiring a Head of Performance Marketing to scale Beauty & Personal Care acquisition, performance marketing budget (₹50 Cr), Google Analytics 4, Adjust, and CDP integration. Reports to CMO."
  },
  // 10. Titan Company CGO
  {
    jobHash: "j-titan-cgo",
    role: "Chief Growth Officer",
    company: "Titan Company",
    location: "Bengaluru · India",
    description: "Titan Company is seeking a CGO for omni-channel growth across Tanishq & Fastrack. Own ₹500 Cr P&L, Salesforce Marketing Cloud, and retail expansion. Reports to Managing Director."
  },
  // 11. Swiggy VP Performance & Growth
  {
    jobHash: "j-swiggy-vp-marketing",
    role: "VP Performance & Growth",
    company: "Swiggy",
    location: "Bengaluru · India",
    description: "Swiggy is hiring VP Growth to drive user acquisition across Instamart & Food Delivery. Own ₹120 Cr budget, Snowflake, Segment, and Braze. Reports to CGO."
  },
  // 12. Bharti Airtel CMO
  {
    jobHash: "j-airtel-cmo",
    role: "Chief Marketing Officer",
    company: "Bharti Airtel",
    location: "Gurugram · India",
    description: "Airtel requires CMO for 5G & Broadband subscriber monetization. Own ₹1,000 Cr marketing P&L and Adobe Experience Cloud. Reports to CEO India."
  },
  // 13. L'Oréal India CGO
  {
    jobHash: "j-loreal-cgo",
    role: "Chief Growth Officer",
    company: "L'Oréal India",
    location: "Mumbai · India",
    description: "L'Oréal India seeks CGO for E-commerce & Luxury Beauty Expansion. Own ₹250 Cr regional P&L, SAP Commerce, and CDP. Reports to Zone President APAC."
  },
  // 14. Paytm VP Growth
  {
    jobHash: "j-paytm-vp-growth",
    role: "VP Growth & Marketing",
    company: "Paytm",
    location: "Noida · India",
    description: "Paytm is hiring VP Growth to scale Soundbox & merchant acquisition. Own ₹80 Cr P&L, AppsFlyer, and Mixpanel. Reports to Senior VP."
  },
  // 15. Urban Company CMO
  {
    jobHash: "j-urbancompany-cmo",
    role: "Chief Marketing Officer",
    company: "Urban Company",
    location: "Gurugram · India",
    description: "Urban Company seeks CMO for global brand & international expansion. Own ₹150 Cr marketing budget and in-house CDP. Reports to Founder & CEO."
  },
  // 16. Ola Mobility VP Digital
  {
    jobHash: "j-ola-vp-digital",
    role: "VP Digital Transformation",
    company: "Ola Mobility",
    location: "Bengaluru · India",
    description: "Ola Mobility is hiring VP Digital Transformation to automate electric fleet operations. Own ₹200 Cr tech budget, Redshift, and Databricks. Reports to Group CTO."
  },
  // 17. Lenskart CGO
  {
    jobHash: "j-lenskart-cgo",
    role: "Chief Growth Officer",
    company: "Lenskart",
    location: "Gurugram · India",
    description: "Lenskart seeks CGO for retail & D2C online scale. Own ₹350 Cr P&L, Shopify Plus, and Klaviyo. Reports to Founder & CEO."
  },
  // 18. TCS Transformation Lead
  rawOpportunities[4],
  // 19. Tata Digital SVP Growth & CRM
  rawOpportunities[6],
  // 20. HUL VP Digital & E-commerce
  rawOpportunities[7]
];

async function main() {
  console.log("=== Generating 20-Profile Forensic Decision Dataset ===");
  const repos = getRepositories();
  const userId = "swapnil-shukla";
  const projection = await repos.people.getLatestProjection(userId);
  
  if (!projection) {
    console.error("No projection found for user", userId);
    return;
  }

  const chunks: string[] = [];
  chunks.push("# 20-Profile Forensic Decision Engine Dataset");
  chunks.push("> **Purpose**: Comprehensive 20-case dataset evaluating RADAR v2's updated Capability Proof & Operational Equivalence Engine, Recruiter Agency Name Resolution, and Pattern Diversification.");
  chunks.push("");

  let count = 0;

  for (const job of test20Jobs) {
    count++;
    const rawObj = {
      id: (job as any).jobHash || (job as any).id || `j-${count}`,
      jobHash: (job as any).jobHash || (job as any).id || `j-${count}`,
      role: (job as any).role || (job as any).title || "Executive Role",
      company: (job as any).company || "Target Company",
      location: (job as any).location || "India",
      description: (job as any).description || (job as any).rawText || (job as any).normalizedText || "",
      dimensions: (job as any).dimensions || []
    };

    const jobProj = JobProjectionBuilder.build(rawObj);
    const capAssessment = CapabilityAssessmentEngine.evaluate(projection, jobProj);

    chunks.push(`\n## Profile ${count}: ${jobProj.role} @ ${jobProj.company}`);
    chunks.push(`* **Resolved Company**: \`${jobProj.company}\` (Raw Input: \`${rawObj.company}\`)`);
    chunks.push(`* **Location**: \`${jobProj.location}\``);
    chunks.push(`* **Identity Classification**: \`${jobProj.executiveIdentity?.value}\``);
    chunks.push(`* **Capability Fit Score**: \`${Math.round(capAssessment.overallFit * 100)}%\``);
    chunks.push(`* **Matching Confidence**: \`${Math.round(capAssessment.matchingConfidence * 100)}%\``);

    chunks.push("\n### 1. Raw Job Description Text");
    chunks.push("<details>\n<summary>Click to expand unedited raw text</summary>\n");
    chunks.push(`\`\`\`text\n${rawObj.description}\n\`\`\``);
    chunks.push("</details>");

    chunks.push("\n### 2. Candidate Projection (Proof Pool Summary)");
    chunks.push("```json\n" + JSON.stringify({
      operatingLevel: projection.operatingLevel?.value,
      commercialScope: projection.commercialScope?.value,
      coreCapabilities: projection.coreCapabilities,
      executiveThemes: projection.executiveThemes
    }, null, 2) + "\n```");

    chunks.push("\n### 3. Extracted Job Projection & Capability Taxonomy");
    chunks.push("```json\n" + JSON.stringify({
      role: jobProj.role,
      company: jobProj.company,
      executiveIdentity: jobProj.executiveIdentity,
      capabilities: jobProj.capabilities
    }, null, 2) + "\n```");

    chunks.push("\n### 4. Upgraded Capability Proof Engine Evaluation");
    chunks.push("```json\n" + JSON.stringify({
      overallFitScore: `${Math.round(capAssessment.overallFit * 100)}%`,
      matchedCapabilities: capAssessment.matchedCapabilities,
      missingCapabilities: capAssessment.missingCapabilities,
      evidenceGrounds: capAssessment.matches
    }, null, 2) + "\n```");

    chunks.push("\n---");
  }

  const outPath = "C:/Users/swapn/.gemini/antigravity/brain/ce7d2ebc-8990-4629-8871-46c6504603ff/decision_examples_20_profiles.md";
  fs.writeFileSync(outPath, chunks.join("\n"));
  console.log("Successfully wrote 20-profile forensic dataset to", outPath);
}

main().catch(console.error);
