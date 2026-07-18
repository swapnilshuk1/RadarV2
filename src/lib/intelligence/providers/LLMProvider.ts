import type { ClassifierProvider } from "../Classifier";
import fs from "fs";
import path from "path";

export class LLMProvider implements ClassifierProvider {
  public name = "LLMProvider";
  private apiKey: string = "";

  constructor() {
    // 1. Try process.env first
    if (typeof process !== "undefined" && process.env && process.env.GROQ_API_KEY) {
      this.apiKey = process.env.GROQ_API_KEY;
    } else if (typeof window === "undefined" && typeof process !== "undefined" && process.cwd) {
      // 2. Fall back to loading groq.env manually
      const groqEnvPath = path.resolve(process.cwd(), "groq.env");
      if (fs.existsSync(groqEnvPath)) {
        try {
          const envContent = fs.readFileSync(groqEnvPath, "utf8");
          for (const line of envContent.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
              const idx = trimmed.indexOf("=");
              if (idx !== -1) {
                const key = trimmed.slice(0, idx).trim();
                const val = trimmed.slice(idx + 1).trim();
                if (key === "GROQ_API_KEY") {
                  this.apiKey = val;
                }
              }
            }
          }
        } catch (err) {
          // Suppress error
        }
      }
    }
  }

  public async classify(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): Promise<{
    value: string;
    confidence: number;
    alternatives?: Array<{ category: string; confidence: number }>;
    evidence: Array<{ quote: string; provenance: string }>;
  }> {
    if (!this.apiKey) {
      // No API key means we gracefully degrade and return low confidence fallback to let RegexProvider win.
      return {
        value: "Other",
        confidence: 0.0,
        evidence: [{ quote: inputs.title, provenance: "LLMProvider: No API Key available" }]
      };
    }

    const cleanDetail = inputs.text ? inputs.text.slice(0, 4000).replace(/\s+/g, ' ').trim() : "";

    const prompt = `You are an elite executive search research orchestrator classifying career opportunities.

Job Details:
- Title: "${inputs.title}"
- Company: "${inputs.company}"
- Location: "${inputs.location}"
- Fragment: "${cleanDetail}"

Task: Classify this job into exactly ONE of our 15 canonical functional categories:
1. "Marketing Leadership" (CMO, Brand Director, Growth VP, VP Performance, Head of Marketing)
2. "Marketing Operations" (MarTech, Marketing Ops, Analytics Lead)
3. "Demand Generation" (Performance Marketing, Acquisition, Paid Ads, Growth Hacker)
4. "Revenue Operations" (RevOps, Sales Ops, CRM Admin, HubSpot Admin)
5. "Partnerships" (Alliance Lead, Channel Manager, BizDev Partner)
6. "Customer Success" (CS Director, CS Lead, CSM)
7. "Enterprise Sales" (AE, Account Executive, Sales Director, BD Lead)
8. "Channel Sales" (Indirect distribution, Retail sales, Account Manager)
9. "Engineering" (CTO, VP Eng, Developer, Software Architect, CISO)
10. "Product" (PM, Product Manager, Product Director, CPO)
11. "HR" (People Ops, Chief People Officer, Recruiter, Talent Partner)
12. "Finance" (CFO, Controller, Financial Analyst, Auditor)
13. "General Management" (CEO, GM, COO, Chief of Staff)
14. "Consulting" (Advisor, Management Consultant, Partner, Strategy Associate)
15. "Other" (Any other corporate or non-corporate functions)

Rules:
- Select the single most accurate category as "primary".
- Provide a confidence score between 0.0 and 1.0 for the primary choice.
- Provide a brief, exact "quote" from the title or job text as justification.
- Provide up to 2 "alternatives" with their respective confidence scores if there is legitimate cross-functional overlap.

Return ONLY a valid JSON object matching the following layout:
{
  "category": "category name",
  "confidence": 0.95,
  "quote": "verbatim text supporting classification",
  "alternatives": [
    { "category": "alternative category name", "confidence": 0.15 }
  ]
}`;

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Wait 3s and retry once
          await new Promise(r => setTimeout(r, 3000));
          return this.classify(inputs);
        }
        throw new Error(`Groq HTTP status ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response choice from Groq");

      const parsed = JSON.parse(content);

      return {
        value: parsed.category || "Other",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.80,
        alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
        evidence: [{
          quote: parsed.quote || inputs.title,
          provenance: "Groq LLM Classifier (llama-3.3-70b-versatile)"
        }]
      };
    } catch (err: any) {
      console.warn(`[LLMProvider] Failed: ${err.message}`);
      return {
        value: "Other",
        confidence: 0.0,
        evidence: [{ quote: inputs.title, provenance: `LLMProvider Error: ${err.message}` }]
      };
    }
  }
}
