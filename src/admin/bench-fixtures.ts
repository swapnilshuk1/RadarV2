import { contextFields, scopeFields, type EvidenceSource, type Claim } from "../dossier/contracts";
import type { StagedResearchInput } from "../dossier/staged-role";
import { configFingerprint, BASELINE_REVISION } from "./config-store";
import { baselineConfig } from "./config-contracts";
const specimens = [
  {
    id: "growth-leadership",
    title: "Head of Growth",
    role: [
      "Lead the growth function and build a 15-person team.",
      "Own revenue growth, customer acquisition and retention.",
      "Design a measurable expansion strategy across India.",
      "Report to the CEO with authority over marketing investment.",
    ],
    candidate: [
      "Led a 20-person growth team across India.",
      "Delivered 30 percent annual revenue growth.",
      "Owned customer acquisition, lifecycle and retention programs.",
    ],
  },
  {
    id: "adjacent-operations",
    title: "Business Transformation Lead",
    role: [
      "Lead an operating transformation across three business units.",
      "Build cross-functional governance and improve customer delivery.",
      "Influence senior functional leaders through a matrix mandate.",
      "Direct operations experience is preferred, not mandatory.",
    ],
    candidate: [
      "Led a 20-person growth team across India.",
      "Established cross-functional delivery governance.",
      "Partnered with operations leadership to improve customer retention.",
    ],
  },
  {
    id: "mandatory-license",
    title: "Medical Services Director",
    role: [
      "An active medical practitioner license is mandatory before appointment.",
      "Provide clinical supervision and approve medical treatment protocols.",
      "Lead a 15-person clinical services team.",
      "Unlicensed applicants cannot be considered for appointment.",
    ],
    candidate: [
      "Led a 20-person commercial growth team across India.",
      "Managed marketing investment and business partnerships.",
      "I do not hold a medical practitioner license.",
    ],
  },
];
export const BENCH_FIXTURE_VERSION = "executive-fixtures-v1";
export function benchFixtures(): StagedResearchInput[] {
  return specimens.map((spec) => {
    const sources: EvidenceSource[] = [
      {
        id: "JD",
        plane: "JD",
        title: "Synthetic job",
        locator: `fixture://${spec.id}/jd`,
        text: spec.role.join(" "),
        capturedAt: "2026-10-01T00:00:00.000Z",
        attribution: "JOB_POST",
      },
      {
        id: "CV",
        plane: "CANDIDATE",
        title: "Synthetic candidate",
        locator: `fixture://${spec.id}/cv`,
        text: spec.candidate.join(" "),
        capturedAt: "2026-10-01T00:00:00.000Z",
        attribution: "CANDIDATE_SUPPLIED",
      },
      {
        id: "CTX",
        plane: "CONTEXT",
        title: "Synthetic company context",
        locator: `fixture://${spec.id}/company`,
        text: "Example Company has 200 employees and is expanding its Indian operations. The CEO has announced a new business unit launch.",
        capturedAt: "2026-10-01T00:00:00.000Z",
        attribution: "COMPANY_PUBLISHED",
      },
    ];
    const evidence: Claim[] = sources.flatMap((source) =>
      (source.id === "JD" ? spec.role : source.id === "CV" ? spec.candidate : [source.text]).map(
        (text, index) => ({
          id: `${source.id}-${index + 1}`,
          text,
          state: "EXPLICIT",
          confidence: 1,
          plane: source.plane,
          citations: [{ sourceId: source.id, quote: text }],
          derivedFrom: [],
        }),
      ),
    );
    return {
      opportunity: { id: spec.id, title: spec.title, company: "Example Company" },
      candidate: { name: "Synthetic Executive" },
      sources,
      evidence,
      candidateSourceRefs: [{ id: "CV", title: "Synthetic candidate" }],
      candidateConflicts: [],
      acquisition: [],
      validEvidenceClaimIds: evidence.map((c) => c.id),
      fields: [...contextFields, ...scopeFields],
      fingerprint: `${BENCH_FIXTURE_VERSION}:${spec.id}:${BASELINE_REVISION}:${configFingerprint(baselineConfig)}`,
    };
  });
}
