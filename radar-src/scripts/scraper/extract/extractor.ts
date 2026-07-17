import type {
  DimensionResult,
  ExtractionResult,
  Importance,
  JobSnapshot,
  Provenance,
  Quality,
  Bucket,
} from "../types";
import { EXTRACTOR_VERSION, EXTRACTOR_PROMPT_VERSION } from "../versions";
import { jobHash } from "../utils/hash";
import { extractRequiredLevel, requiredLevelExtractorId } from "./dimensions/requiredLevel";
import { extractReportingLine, reportingLineExtractorId } from "./dimensions/reportingLine";
import { extractMandate, mandateExtractorId } from "./dimensions/mandate";
import { extractCommercial, commercialExtractorId } from "./dimensions/commercialAccountability";
import { extractFunctionalScope, functionalScopeExtractorId } from "./dimensions/functionalScope";
import { extractGeography, geographyExtractorId } from "./dimensions/geography";
import { extractWorkModel, workModelExtractorId } from "./dimensions/workModel";
import { extractTechnologyStack, technologyStackExtractorId } from "./dimensions/technologyStack";
import type { EnrichmentProvider } from "../enrich/contract";
import { geminiProvider } from "../enrich/providers/gemini";
import { pickMissingForEnrichment, resolveMode, type EnrichmentMode } from "../enrich/policy";
import type { Anchored } from "./anchor";

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
  { key: "reportingLine", label: "Reporting Line", importance: "Core", extractorId: reportingLineExtractorId,
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
  { key: "technologyStack", label: "Technology Stack", importance: "Context", extractorId: technologyStackExtractorId,
    run: (i) => extractTechnologyStack({ snippet: i.snippet, detailText: i.detailText }),
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

// Deterministic-first extraction. LLM is called only when the enrichment
// policy allows (default: smart — Core-missing only). Provider output is
// always marked Inferred, never Explicit (extractor-remediation §6).
export async function extract(snapshot: JobSnapshot, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  const mode = opts.mode ?? resolveMode();
  const provider = opts.provider ?? geminiProvider;
  const t0 = Date.now();
  const title = snapshot.card.title || "";
  const company = snapshot.card.company || "";
  const location = snapshot.card.location || "";
  const snippet = snapshot.card.rawText || "";
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
        value: res.value,
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
    const lt0 = Date.now();
    llmCalled = true;
    llmFallbackReason = `${mode}:${toFill.map((d) => d.key).join(",")}`;
    try {
      const filled = await provider.enrich({
        title, company, location, snippet, detailText,
        applyUrl, portal: snapshot.portal,
        missingKeys: toFill.map((d) => d.key),
      });
      for (const d of toFill) {
        const patch = filled?.[d.key];
        if (patch && patch.value) {
          d.jdEvidence.value = patch.value;
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
    llmMs = Date.now() - lt0;
  }


  return {
    extractorVersion: EXTRACTOR_VERSION,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
    jobHash: jobHash(title, company),
    role: title,
    company,
    location,
    postedRelative: snapshot.card.postedAtISO ? "Posted recently" : "Posted recently",
    scrapedFrom: snapshot.portal,
    primaryConcern: null,
    applyUrl,
    dimensions: dims,
    telemetry: { deterministicMs: detMs, llmMs, llmCalled, llmFallbackReason },
  };
}
