import fs from "fs";
import path from "path";
import { SNAPSHOT_DIR } from "./scraper/config";
import type { JobSnapshot, BenchmarkEntry, BenchmarkTruth, ExpectedRecommendation } from "./scraper/types";
import { createLimiter } from "./scraper/utils/limit";

// Use same groq call structure as enrichment

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY required");
  process.exit(1);
}

const llmLimiter = createLimiter(3);

async function groqCall(prompt: string): Promise<any> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`Groq Error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

function getDraftPrompt(snap: JobSnapshot): string {
  return `You are an executive search analyst. Create the "Golden Truth" benchmark for this job posting.
Extract facts exactly as they appear in the job description. Do not invent requirements.

Job posting:
Title: ${snap.card?.title || ""}
Company: ${snap.card?.company || ""}
Location: ${snap.card?.location || ""}
Raw Text:
${(snap.detail?.rawText || snap.card?.rawText || "").slice(0, 10000)}

Your task:
Output a JSON object exactly matching this schema:
{
  "truth": {
    "role": { "value": "<exact title>", "evidence": "<quote supporting this>" },
    "company": { "value": "<exact company>", "evidence": "<quote>" },
    "location": { "value": "<exact location>", "evidence": "<quote>" },
    "salary": { "value": "<exact salary or null>", "evidence": "<quote or null>" },
    "mustHave": [{ "value": "<requirement>", "evidence": "<quote>" }],
    "niceToHave": [{ "value": "<requirement>", "evidence": "<quote>" }],
    "tools": [{ "value": "<tool/software>", "evidence": "<quote>" }],
    "technologies": [{ "value": "<technology>", "evidence": "<quote>" }],
    "leadershipLevel": { "value": "<Manager/Director/VP/C-Level/IC or null>", "evidence": "<quote>" },
    "aiExposure": { "value": <true/false/null>, "evidence": "<quote>" },
    "travel": { "value": "<High/Medium/Low/None or null>", "evidence": "<quote>" },
    "remoteType": { "value": "<Remote/Hybrid/On-site or null>", "evidence": "<quote>" }
  },
  "expectedRecommendation": {
    "fit": "<Excellent/Average/Poor>",
    "reason": ["<reason 1>", "<reason 2>"]
  }
}

Rules:
- \`value\` for Category A/C fields must be strings, booleans, or null.
- \`mustHave\`, \`niceToHave\`, \`tools\`, \`technologies\` must be arrays of objects.
- \`evidence\` MUST be an exact verbatim substring from the Raw Text that proves the value.
- If a field is not explicitly mentioned, its \`value\` must be null and \`evidence\` must be null. Do not infer!
- For \`expectedRecommendation\`, assume the candidate is a senior digital/growth executive looking for a VP/CMO role with P&L and AI exposure. Evaluate fit based on that profile.`;
}

async function main() {
  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'));
  const snapshots: JobSnapshot[] = [];
  
  // 1. Collect
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, f), "utf-8");
    snapshots.push(JSON.parse(raw));
  }
  
  // 2. Deduplicate
  const uniqueSnaps: JobSnapshot[] = [];
  const seenKeys = new Set<string>();
  for (const s of snapshots) {
    const title = (s as any).title || s.card?.title || "";
    const company = (s as any).company || s.card?.company || "";
    const location = (s as any).location || s.card?.location || "";
    
    if (!title && !company) continue; // skip invalid
    
    const key = `${title}|${company}|${location}`.toLowerCase().trim();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueSnaps.push(s);
    }
  }
  console.log(`Loaded ${snapshots.length} snapshots, ${uniqueSnaps.length} unique.`);
  
  // 3. Balanced Sampling (10 Short, 10 Med, 10 Long) to approximate Easy/Medium/Hard
  uniqueSnaps.sort((a, b) => {
    const aLen = (a.detail?.rawText || (a as any).rawText || a.card?.rawText || "").length;
    const bLen = (b.detail?.rawText || (b as any).rawText || b.card?.rawText || "").length;
    return aLen - bLen;
  });
  
  const selected: JobSnapshot[] = [];
  const third = Math.floor(uniqueSnaps.length / 3);
  
  // Pick 10 short (Easy)
  for (let i = 0; i < Math.min(10, third); i++) selected.push(uniqueSnaps[i]);
  // Pick 10 medium (Medium)
  for (let i = third; i < Math.min(third + 10, 2 * third); i++) selected.push(uniqueSnaps[i]);
  // Pick 10 long (Hard)
  for (let i = 2 * third; i < Math.min(2 * third + 10, uniqueSnaps.length); i++) selected.push(uniqueSnaps[i]);
  
  console.log(`Selected ${selected.length} JDs for the golden draft.`);
  
  // 4. Draft
  const entries: BenchmarkEntry[] = [];
  let count = 0;
  
  await Promise.all(selected.map(async (snap, idx) => {
    await llmLimiter.run(async () => {
      const title = (snap as any).title || snap.card?.title || "";
      const company = (snap as any).company || snap.card?.company || "";
      const location = (snap as any).location || snap.card?.location || "";
      
      console.log(`[${idx + 1}/${selected.length}] Drafting: ${title} @ ${company}...`);
      try {
        const rawText = snap.detail?.rawText || (snap as any).rawText || snap.card?.rawText || "";
        
        // Re-generate prompt with correct properties
        const prompt = `You are an executive search analyst. Create the "Golden Truth" benchmark for this job posting.
Extract facts exactly as they appear in the job description. Do not invent requirements.

Job posting:
Title: ${title}
Company: ${company}
Location: ${location}
Raw Text:
${rawText.slice(0, 10000)}

Your task:
Output a JSON object exactly matching this schema:
{
  "truth": {
    "role": { "value": "<exact title>", "evidence": "<quote supporting this>" },
    "company": { "value": "<exact company>", "evidence": "<quote>" },
    "location": { "value": "<exact location>", "evidence": "<quote>" },
    "salary": { "value": "<exact salary or null>", "evidence": "<quote or null>" },
    "mustHave": [{ "value": "<requirement>", "evidence": "<quote>" }],
    "niceToHave": [{ "value": "<requirement>", "evidence": "<quote>" }],
    "tools": [{ "value": "<tool/software>", "evidence": "<quote>" }],
    "technologies": [{ "value": "<technology>", "evidence": "<quote>" }],
    "leadershipLevel": { "value": "<Manager/Director/VP/C-Level/IC or null>", "evidence": "<quote>" },
    "aiExposure": { "value": <true/false/null>, "evidence": "<quote>" },
    "travel": { "value": "<High/Medium/Low/None or null>", "evidence": "<quote>" },
    "remoteType": { "value": "<Remote/Hybrid/On-site or null>", "evidence": "<quote>" }
  },
  "expectedRecommendation": {
    "fit": "<Excellent/Average/Poor>",
    "reason": ["<reason 1>", "<reason 2>"]
  }
}

Rules:
- \`value\` for Category A/C fields must be strings, booleans, or null.
- \`mustHave\`, \`niceToHave\`, \`tools\`, \`technologies\` must be arrays of objects.
- \`evidence\` MUST be an exact verbatim substring from the Raw Text that proves the value.
- If a field is not explicitly mentioned, its \`value\` must be null and \`evidence\` must be null. Do not infer!
- For \`expectedRecommendation\`, assume the candidate is a senior digital/growth executive looking for a VP/CMO role with P&L and AI exposure. Evaluate fit based on that profile.`;

        const result = await groqCall(prompt);
        
        let difficulty: "Easy" | "Medium" | "Hard" = "Medium";
        if (rawText.length < 1500) difficulty = "Easy";
        else if (rawText.length > 5000) difficulty = "Hard";
        
        entries.push({
          id: `bm-${snap.cardHash}`,
          cardHash: snap.cardHash,
          portal: snap.portal,
          difficulty,
          isNegativeExample: false, // human reviewer can toggle this
          rawHtml: snap.detail?.rawHtml || (snap as any).rawHtml || snap.card?.rawHtml || "",
          rawText,
          metadata: {
            originalTitle: title,
            originalCompany: company,
            url: snap.detailUrl
          },
          truth: result.truth as BenchmarkTruth,
          expectedRecommendation: result.expectedRecommendation as ExpectedRecommendation
        });
        count++;
        console.log(`  -> Completed ${count}/${selected.length}`);
      } catch (e: any) {
        console.error(`  -> Failed ${title}:`, e.message);
      }
    });
  }));
  
  const outFile = path.join(process.cwd(), "src/data/benchmark/dataset-v1-draft.json");
  fs.writeFileSync(outFile, JSON.stringify({ version: "1.0-draft", entries }, null, 2));
  console.log(`\nWrote ${entries.length} drafts to ${outFile}`);
}

main().catch(console.error);
