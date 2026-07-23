import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface DimensionResult {
  key: string;
  label: string;
  importance: string;
  bucket: string;
  jdEvidence: {
    value: any;
    status: string;
    evidence: string[];
  };
}

interface Opportunity {
  role: string;
  company: string;
  location: string;
  normalizedText: string;
  dimensions?: DimensionResult[];
  whyNow?: string;
  positioning?: string;
}

// ADC Token retrieval helper matching profile-server.ts
function getADCToken(): string | null {
  try {
    let cmd = "gcloud";
    if (process.platform === "win32") {
      const commonPaths = [
        "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        path.join(process.env.USERPROFILE || "", "AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"),
        "C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          cmd = `"${p}"`;
          break;
        }
      }
    }
    const token = execSync(`${cmd} auth application-default print-access-token`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token || null;
  } catch (err: any) {
    return null;
  }
}

// Prompt calling Gemini 2.5 Flash supporting both API Key and ADC Fallback
async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";

  if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  } else {
    const adcToken = getADCToken();
    if (!adcToken) {
      throw new Error("No Gemini credentials (GEMINI_API_KEY or gcloud application-default print-access-token) available.");
    }
    headers["Authorization"] = `Bearer ${adcToken}`;
    const projectId = process.env.GCP_PROJECT_ID || "project-0e166cfc-e3f5-49d7-af6";
    url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API call failed: ${res.statusText} - ${text}`);
  }

  const json = await res.json() as any;
  // Handle both Generative Language API and Vertex AI API formats
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text || 
                  json.predictions?.[0]?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error(`Empty response from Gemini API. Response payload: ${JSON.stringify(json)}`);
  }
  return content;
}

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
}

async function runExperiment() {
  console.log("=== STARTING THE bespoke LLM EDITORIAL EXPERIMENT ===");
  loadEnv();

  // 1. Load candidate profile
  const profilePath = path.resolve(process.cwd(), "src/data/candidate-profile.json");
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  console.log(`Loaded candidate profile for: ${profile.identity.name} (${profile.executiveIdentity.archetype})`);

  // 2. Load opportunities
  const scrapedPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  if (!fs.existsSync(scrapedPath)) {
    console.error(`live-scraped.json not found at ${scrapedPath}`);
    process.exit(1);
  }
  const jobs: Opportunity[] = JSON.parse(fs.readFileSync(scrapedPath, "utf-8"));
  console.log(`Loaded ${jobs.length} opportunities.`);

  // 3. Let's select three representative jobs:
  // - A growth leader / CMO role (perfect PURSUE)
  // - A strategy / advisory role (CONSIDER)
  // - A technical developer or unrelated role (PASS)
  
  const pursueJob = jobs.find(j => 
    j.role.toLowerCase().includes("growth") || 
    j.role.toLowerCase().includes("cmo") || 
    j.role.toLowerCase().includes("marketing")
  ) || jobs[0];

  const considerJob = jobs.find(j => 
    j.role.toLowerCase().includes("strategy") || 
    j.role.toLowerCase().includes("transformation") ||
    j.role.toLowerCase().includes("consulting")
  ) || jobs[1];

  const passJob = jobs.find(j => 
    (!j.role.toLowerCase().includes("marketing") && 
     !j.role.toLowerCase().includes("growth") && 
     !j.role.toLowerCase().includes("strategy"))
  ) || jobs[jobs.length - 1];

  const selectedJobs = [
    { type: "PURSUE", job: pursueJob },
    { type: "CONSIDER", job: considerJob },
    { type: "PASS", job: passJob }
  ];

  let markdownOutput = `# Bespoke LLM Recommendation Experiment

This report documents a structured **Thought Experiment**: comparing our static rules-based dynamic templates against **bespoke LLM recommendations** generated on-the-fly by feeding the raw extracted evidence and the candidate profile directly to the LLM.

## Candidate Profile Reference
- **Name**: ${profile.identity.name}
- **Role**: ${profile.identity.currentTitle}
- **Archetype**: ${profile.executiveIdentity.archetype}
- **Value Proposition**: ${profile.executiveIdentity.valueProposition}

---

`;

  for (const { type, job } of selectedJobs) {
    console.log(`\nProcessing ${type} Opportunity: ${job.role} at ${job.company}...`);

    // Extract raw evidence quotes and statuses
    const dimensionDetails = (job.dimensions || []).map(d => {
      return `Dimension: ${d.label} (${d.key})
- Alignment Status: ${d.jdEvidence.status}
- Extracted Value: ${JSON.stringify(d.jdEvidence.value)}
- Verbatim Evidence Quotes from Job Description:
${d.jdEvidence.evidence.map(e => `  > "${e}"`).join("\n") || "  (No quote extracted)"}
`;
    }).join("\n---\n");

    const prompt = `You are an elite, Superhuman-grade Executive Talent Advisory LLM.
Your task is to review the structured capability evidence matching a top-tier candidate against an active executive job listing and write a highly personalized, strategically rigorous advisory recommendation briefing.

### Candidate Profile:
- Name: ${profile.identity.name}
- Archetype: ${profile.executiveIdentity.archetype}
- Value Proposition: ${profile.executiveIdentity.valueProposition}
- Experience: ${profile.experience.yearsExperience} Years, P&L Ownership: ${profile.experience.plOwnership}, Team Managed: ${profile.experience.teamSizeManaged} people, Fee Book Scale: ${profile.experience.feeBookScale}
- Verifiable Key Achievements:
${profile.experience.achievements.map((a: string) => `  * ${a}`).join("\n")}

### Job Opportunity Details:
- Role: ${job.role}
- Company: ${job.company}
- Location: ${job.location}

### Extracted Evidence Match for this Job:
${dimensionDetails}

---

Please write a bespoke, executive-level editorial briefing tailored for this candidate. Do NOT use generic buzzwords or vague compliments. Speak in the tone of a premium advisory register (such as Superhuman, Notion, or McKinsey advisory briefs). 

Structure your response in markdown with the following specific sections:

1. **Executive Recommendation**: A crisp, professional advisory verdict (typically 3-4 sentences) that directly states whether they should pursue, consider, or pass on this seat, referencing specific scope parameters (P&L, team, or geography alignment).
2. **\"Why Now\" (The Inflection Moment)**: A strategically acute paragraph describing the hiring company's current business moment and mandate, and why the candidate's playbook is perfectly (or poorly) timed for it.
3. **Strategic Points of Leverage**: A bulleted list of 2-3 precise positioning hooks showing how the candidate's specific past achievements (e.g., specific budget scales, GCC setups, CRM migrations, or lead volumes) directly address the company's extracted problems.
4. **Hiring Risks / Due Diligence**: Specific, contrarian risk vectors or questions they must ask in the first interview (e.g., is there genuine P&L authority, what is the level of stakeholder buy-in, or is the team size undersized).

Respond ONLY with the markdown sections. Do not include any HTML frames or enclosing conversational chatter.`;

    try {
      const result = await callGemini(prompt);
      
      markdownOutput += `## [${type}] ${job.role} — ${job.company}
**Location**: ${job.location}

### Raw Description Match
* **Description Length**: ${job.normalizedText.length} characters

### Bespoke LLM Recommendation Briefing
${result}

---

`;
      console.log(`Successfully generated bespoke recommendation for ${job.role}.`);
    } catch (err: any) {
      console.error(`Error processing ${job.role}:`, err.message);
      markdownOutput += `## [${type}] ${job.role} — ${job.company}
*Failed to generate bespoke recommendation:* ${err.message}

---

`;
    }
  }

  // 4. Save report in artifacts
  const artifactDir = path.resolve(process.cwd(), "..", "..", ".gemini", "antigravity", "brain", "98fc6af1-d28e-448d-bb5d-eae7cc7b6f67");
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }
  const outputPath = path.join(artifactDir, "experimental_editorial_report.md");
  fs.writeFileSync(outputPath, markdownOutput, "utf-8");

  console.log(`\n=== EXPERIMENT COMPLETE ===`);
  console.log(`Result saved to artifact path:\n[experimental_editorial_report.md](file:///${outputPath.replace(/\\/g, "/")})`);
}

runExperiment();
