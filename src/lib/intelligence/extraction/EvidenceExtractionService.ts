/**
 * EvidenceExtractionService.ts
 *
 * Extract facts from unstructured text into an EvidenceGraph.
 * LLMs extract raw facts without performing ontology mapping or business rule derivations.
 * ADR-011: Evidence is Immutable.
 */

import type { EvidenceGraph, ExtractedFact, FactType } from "../../../domain/evidence";
import fs from "fs";
import path from "path";

export interface EvidenceExtractionInput {
  personId: string;
  documentId: string;
  documentHash: string;
  documentText: string;
}

export class EvidenceExtractionService {
  private apiKey: string = "";
  private extractorVersion = "1.0.0";
  private promptVersion = "v1.0";
  private modelName = "llama-3.3-70b-versatile";

  constructor() {
    if (typeof process !== "undefined" && process.env && process.env.GROQ_API_KEY) {
      this.apiKey = process.env.GROQ_API_KEY;
    } else if (typeof window === "undefined" && typeof process !== "undefined" && process.cwd) {
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
        } catch {
          /* ignore */
        }
      }
    }
  }

  public async extract(input: EvidenceExtractionInput): Promise<EvidenceGraph> {
    const graphId = `ev-graph-${input.documentId}-${Date.now()}`;
    const now = new Date().toISOString();

    if (!this.apiKey) {
      console.warn("[EvidenceExtractionService] No GROQ_API_KEY found; falling back to heuristic parsing.");
      return this.heuristicExtract(input, graphId, now);
    }

    const cleanText = input.documentText.slice(0, 10000).replace(/\s+/g, " ").trim();

    const prompt = `You are a factual evidence extraction engine.
Your single job is to extract exact, verifiable facts from the provided candidate document text.

Document Text:
"${cleanText}"

Instructions:
Extract discrete facts and categorize each into ONE of the following types:
- "EMPLOYMENT": Role titles, company names, tenure, team size managed, budget managed.
- "ACHIEVEMENT": Specific quantified outcomes, revenue growth, cost reductions, turnarounds.
- "TECHNOLOGY": Software platforms, MarTech, programming languages, cloud systems, frameworks used.
- "LEADERSHIP": Board reporting, org design, cross-functional scope, direct report counts.
- "EDUCATION": Degrees, universities, certifications.
- "LOCATION": Geographic bases, multi-market or regional coverage.
- "OTHER": Misc factual claims.

Rules:
1. Extract ALL facts without omitting low-confidence items (include a confidence score 0.0 to 1.0 for each).
2. DO NOT infer future intent or candidate preferences.
3. DO NOT perform internal ontology mappings or level classifications.
4. Provide the exact "sourceSpan" (verbatim or near-verbatim quote from the document text).
5. PRESERVE exact raw wording, original currency (e.g. ₹ INR, $ USD), and original magnitude (e.g. "₹500 crore", "$50M"). DO NOT perform early currency conversion or unit normalization.

Return ONLY a JSON object formatted as:
{
  "facts": [
    {
      "type": "EMPLOYMENT" | "ACHIEVEMENT" | "TECHNOLOGY" | "LEADERSHIP" | "EDUCATION" | "LOCATION" | "OTHER",
      "value": "Fact summary string",
      "confidence": 0.95,
      "sourceSpan": "Exact text quote",
      "justification": "Why this fact was extracted"
    }
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
          model: this.modelName,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        throw new Error(`Groq HTTP status ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response choice from Groq");

      const parsed = JSON.parse(content);
      const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : [];

      const facts: ExtractedFact[] = rawFacts.map((f: any, idx: number) => ({
        id: `fact-${input.documentId}-${idx + 1}`,
        type: (f.type as FactType) || "OTHER",
        value: String(f.value || ""),
        confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
        sourceSpan: String(f.sourceSpan || ""),
        justification: String(f.justification || "")
      }));

      return {
        id: graphId,
        personId: input.personId,
        facts,
        provenance: {
          documentId: input.documentId,
          documentHash: input.documentHash,
          extractorVersion: this.extractorVersion,
          promptVersion: this.promptVersion,
          model: this.modelName,
          createdAt: now
        }
      };
    } catch (err: any) {
      console.warn(`[EvidenceExtractionService] LLM extraction failed: ${err.message}; using heuristic fallback.`);
      return this.heuristicExtract(input, graphId, now);
    }
  }

  private heuristicExtract(input: EvidenceExtractionInput, graphId: string, createdAt: string): EvidenceGraph {
    const lines = input.documentText.split("\n").map(l => l.trim()).filter(Boolean);
    const facts: ExtractedFact[] = lines.slice(0, 30).map((line, idx) => ({
      id: `fact-${input.documentId}-h-${idx + 1}`,
      type: "OTHER",
      value: line,
      confidence: 0.5,
      sourceSpan: line.slice(0, 100),
      justification: "Heuristic fallback line extraction"
    }));

    return {
      id: graphId,
      personId: input.personId,
      facts,
      provenance: {
        documentId: input.documentId,
        documentHash: input.documentHash,
        extractorVersion: `${this.extractorVersion}-fallback`,
        promptVersion: "heuristic-v1",
        model: "heuristic",
        createdAt
      }
    };
  }
}
