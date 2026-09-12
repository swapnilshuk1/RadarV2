// Adapter that turns each per-dimension anchor extractor into an object
// implementing the DimensionExtractor contract. Uses the same inputs as
// the orchestrator in extractor.ts so behaviour matches exactly.
import type {
  Bucket,
  DimensionResult,
  Importance,
  JobSnapshot,
  Provenance,
  Quality,
} from "../types";
import type { DimensionExtractor } from "./contract";
import type { Anchored } from "./anchor";
import { extractRequiredLevel, requiredLevelExtractorId } from "./dimensions/requiredLevel";
import { extractReportingLine, reportingLineExtractorId } from "./dimensions/reportingLine";
import { extractMandate, mandateExtractorId } from "./dimensions/mandate";
import { extractCommercial, commercialExtractorId } from "./dimensions/commercialAccountability";
import { extractFunctionalScope, functionalScopeExtractorId } from "./dimensions/functionalScope";
import { extractGeography, geographyExtractorId } from "./dimensions/geography";
import { extractWorkModel, workModelExtractorId } from "./dimensions/workModel";
import { extractTechnologyStack, technologyStackExtractorId } from "./dimensions/technologyStack";

interface Spec {
  key: string;
  label: string;
  importance: Importance;
  extractorId: string;
  run: (i: { title: string; snippet: string; detailText: string; location: string }) => Anchored<string>;
  proofHeadline: string;
  proofDetail: string;
}

const SPECS: Spec[] = [
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

function bucketOf(status: "Explicit" | "Inferred" | "Missing"): Bucket {
  if (status === "Explicit") return "Matched";
  if (status === "Inferred") return "Adjacent";
  return "Missing";
}
function provenanceOf(status: "Explicit" | "Inferred" | "Missing"): Provenance {
  if (status === "Explicit") return "explicit";
  if (status === "Inferred") return "inferred";
  return "llm";
}
function qualityOf(status: "Explicit" | "Inferred" | "Missing", n: number): Quality {
  if (status === "Explicit" && n > 0) return "high";
  if (status === "Inferred") return "medium";
  return "low";
}

export function getExtractorRegistry(): DimensionExtractor[] {
  return SPECS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    importance: spec.importance,
    extractorId: spec.extractorId,
    extract(snapshot: JobSnapshot): DimensionResult {
      const title = snapshot.card.title || "";
      const snippet = snapshot.card.rawText || "";
      const detailText = snapshot.detail.rawText || "";
      const location = snapshot.card.location || "";
      const res = spec.run({ title, snippet, detailText, location });
      return {
        key: spec.key,
        label: spec.label,
        importance: spec.importance,
        bucket: bucketOf(res.status),
        jdEvidence: {
          value: res.value,
          status: res.status,
          evidence: res.evidence,
          provenance: provenanceOf(res.status),
          quality: qualityOf(res.status, res.evidence.length),
          extractorId: spec.extractorId,
        },
        candidateProof: { headline: spec.proofHeadline, detail: spec.proofDetail },
      };
    },
  }));
}
