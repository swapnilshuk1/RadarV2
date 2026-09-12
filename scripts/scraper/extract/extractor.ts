import type {
  DimensionResult,
  ExtractionResult,
  Importance,
  DetailedCard,
  Provenance,
  Quality,
  Bucket,
} from "../types";
import { EXTRACTOR_VERSION, EXTRACTOR_PROMPT_VERSION } from "../versions";
import { jobHash } from "../utils/hash";
import { extractRequiredLevel, requiredLevelExtractorId } from "./dimensions/requiredLevel";
import { extractReportingLine, reportingExtractorId } from "./dimensions/reportingLine";
import { extractMandate, mandateExtractorId } from "./dimensions/mandate";
import { extractCommercial, commercialExtractorId } from "./dimensions/commercialAccountability";
import { extractFunctionalScope, functionalScopeExtractorId } from "./dimensions/functionalScope";
import { extractGeography, geographyExtractorId } from "./dimensions/geography";
import { extractWorkModel, workModelExtractorId } from "./dimensions/workModel";
import { extractTechnology, technologyExtractorId } from "./dimensions/technologyStack";
import type { EnrichmentProvider } from "../enrich/contract";
import { defaultProvider } from "../enrich/providers/index";
import { pickMissingForEnrichment, resolveMode, type EnrichmentMode } from "../enrich/policy";
import type { Anchored } from "./anchor";
import { createLimiter } from "../utils/limit";
import { CONFIG } from "../config";

interface DimSpec {
  key: string;
  label: string;
  importance: Importance;
  extractorId: string;
  run: (input: { title: string; snippet: string; detailText: string; location: string }) => Anchored<string>;
  proofHeadline: string;
  proofDetail: string;
}

const SPECS: DimSpec[] = [
  { key: "requiredLevel", label: "Required Level", importance: "Core", extractorId: requiredLevelExtractorId,
    run: (i) => extractRequiredLevel(i), proofHeadline: "Seniority check", proofDetail: "Matches target title list" },
  { key: "reportingLine", label: "Reporting Line", importance: "Core", extractorId: reportingExtractorId,
    run: (i) => extractReportingLine(i), proofHeadline: "Reporting line alignment", proofDetail: "CxO / MD reporting proven" },
  { key: "mandate", label: "Mandate", importance: "Core", extractorId: mandateExtractorId,
    run: (i) => extractMandate(i), proofHeadline: "Mandate alignment", proofDetail: "Lifecycle stage matches profile" },
  { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", extractorId: commercialExtractorId,
    run: (i) => extractCommercial(i), proofHeadline: "P&L Scale matches", proofDetail: "Prior P&L / budget precedent" },
  { key: "functionalScope", label: "Functional Scope", importance: "Supporting", extractorId: functionalScopeExtractorId,
    run: (i) => extractFunctionalScope(i), proofHeadline: "Competency match", proofDetail: "Full growth capability stack" },
  { key: "geography", label: "Geography", importance: "Supporting", extractorId: geographyExtractorId,
    run: (i) => extractGeography({ location: i.location, snippet: i.snippet, detailText: i.detailText }),
    proofHeadline: "Location match", proofDetail: "Target market listing matches" },
  { key: "workModel", label: "Work Model", importance: "Context", extractorId: workModelExtractorId,
    run: (i) => extractWorkModel({ snippet: i.snippet, detailText: i.detailText }),
    proofHeadline: "Work model preference", proofDetail: "Preferred work model" },
  { key: "technologyStack", label: "Technology Stack", importance: "Context", extractorId: technologyExtractorId,
    run: (i) => extractTechnology({ title: i.title, snippet: i.snippet, detailText: i.detailText }),
    proofHeadline: "Platform stack", proofDetail: "Platform-native experience" },
];

function toBucket(status: "Explicit" | "Inferred" | "Missing"): Bucket {
  if (status === "Explicit") return "Matched";
  if (status === "Inferred") return "Adjacent";
  return "Missing";
}

function toProvenance(status: "Explicit" | "Inferred" | "Missing"): Provenance {
  if (status === "Explicit") return "explicit";
  if (status === "Inferred") return "inferred";
  return "llm";
}

function toQuality(status: "Explicit" | "Inferred" | "Missing", evidenceCount: number): Quality {
  if (status === "Explicit" && evidenceCount > 0) return "high";
  if (status === "Inferred") return "medium";
  return "low";
}

export interface ExtractOptions {
  mode?: EnrichmentMode;
  provider?: EnrichmentProvider;
}

const llmLimiter = createLimiter(CONFIG.llmConcurrency);

let queueWaitTimes: number[] = [];

export function getLLMQueueStats() {
  queueWaitTimes.sort((a, b) => a - b);
  const count = queueWaitTimes.length;
  const totalWait = queueWaitTimes.reduce((a, b) => a + b, 0);
  const p95 = count > 0 ? queueWaitTimes[Math.floor(count * 0.95)] : 0;
  
  return { 
    totalWait, 
    count,
    avg: count > 0 ? totalWait / count : 0,
    p95,
    active: llmLimiter.activeCount,
    pending: llmLimiter.pendingCount
  };
}

// Deterministic-first extraction. LLM is called only when the enrichment
// policy allows (default: smart — Core-missing only). Provider output is
// always marked Inferred, never Explicit (extractor-remediation §6).
export function cleanDimensionValue(val: string | null): string | null {
  if (!val) return null;
  const str = String(val).trim();
  if (str.startsWith("{") && str.includes('"')) {
    try {
      const parsed = JSON.parse(str);
      const clean = parsed.value || parsed.canonicalValue || parsed.rawValue;
      if (clean) return String(clean).trim();
    } catch {}
  }
  return str;
}

export async function extract(snapshot: DetailedCard, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  const mode = opts.mode ?? resolveMode();
  const provider = opts.provider ?? defaultProvider;
  const t0 = Date.now();
  const title = snapshot.title || "";
  const company = snapshot.company || "";
  const location = snapshot.location || "";
  const snippet = snapshot.rawText || "";
  const detailText = snapshot.detail.rawText || "";
  const applyUrl = snapshot.detailUrl;

  const dims: DimensionResult[] = SPECS.map((spec) => {
    const res = spec.run({ title, snippet, detailText, location });
    return {
      key: spec.key,
      label: spec.label,
      importance: spec.importance,
      bucket: toBucket(res.status),
      jdEvidence: {
        value: cleanDimensionValue(res.value),
        status: res.status,
        evidence: res.evidence,
        provenance: toProvenance(res.status),
        quality: toQuality(res.status, res.evidence.length),
        extractorId: spec.extractorId,
      },
      candidateProof: { headline: spec.proofHeadline, detail: spec.proofDetail },
    };
  });

  const detMs = Date.now() - t0;

  // Coverage-gated enrichment: policy chooses which dimensions get sent.
  const toFill = pickMissingForEnrichment(dims, mode);
  let llmMs = 0;
  let llmCalled = false;
  let llmFallbackReason: string | undefined;

  if (toFill.length > 0) {
    llmCalled = true;
    llmFallbackReason = `${mode}:${toFill.map((d) => d.key).join(",")}`;
    const startWait = Date.now();
    try {
      const filled = await llmLimiter.run(async () => {
        const queueTime = Date.now() - startWait;
        queueWaitTimes.push(queueTime);
        
        const lt0 = Date.now();
        const res = await provider.enrich({
          title, company, location, snippet, detailText,
          applyUrl, portal: snapshot.portal,
          missingKeys: toFill.map((d) => d.key),
        });
        llmMs = Date.now() - lt0;
        return res;
      });

      for (const d of toFill) {
        const patch = filled?.[d.key];
        if (patch && patch.value) {
          d.jdEvidence.value = cleanDimensionValue(patch.value);
          // Inferred (LLM-provided), NOT Explicit — never claims verbatim.
          d.jdEvidence.status = "Inferred";
          d.jdEvidence.provenance = "llm";
          d.jdEvidence.quality = "medium";
          d.jdEvidence.extractorId = provider.id;
          d.bucket = "Adjacent";
        }
      }
    } catch (err: any) {
      llmFallbackReason = `llm_error:${err?.message || "unknown"}`;
    }
  }


  return {
    extractorVersion: EXTRACTOR_VERSION,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    jobHash: jobHash(title, company),
    role: title,
    company,
    location,
    postedRelative: "Posted recently",
    scrapedFrom: snapshot.portal,
    primaryConcern: null,
    applyUrl,
    dimensions: dims,
    normalizedText: detailText || snippet,
    telemetry: { deterministicMs: detMs, llmMs, llmCalled, llmFallbackReason },
  };
}
