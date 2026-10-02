import { readPinnedIntelligence } from "../../evaluation/intelligence-taxonomy";
import { matchIntelligence } from "../ontology/intelligence-taxonomy";
/** Deterministic eligibility boundary; it schedules evaluation, never scores. */
import type { OpportunityVersion, AttentionDecision } from "@/lib/domain/canonical_acquisition";
import type {
  EligibilitySpec,
  LocationEligibilityPolicy,
  SearchCriteriaPayload,
} from "@/evaluation/context-contracts";
import type { JobProjection } from "@/lib/domain/job_projection";
import { GeographyResolver } from "@/lib/intelligence/semantic/resolvers/GeographyResolver";
import { SeniorityResolver } from "@/lib/intelligence/semantic/resolvers/SeniorityResolver";
import type { SeniorityBand } from "@/lib/intelligence/semantic/types";

export type EligibilityDecision = "ELIGIBLE" | "REVIEW" | "INELIGIBLE";
export type EligibilityReasonCode =
  | "ROLE_FAMILY_MATCH"
  | "ADJACENT_ROLE_FAMILY"
  | "ROLE_UNKNOWN"
  | "EXCLUDED_COMPANY"
  | "FUNCTION_CONTRADICTION"
  | "FUNCTION_REVIEW"
  | "SENIORITY_CONTRADICTION"
  | "SENIORITY_REVIEW"
  | "EMPLOYMENT_CONTRADICTION"
  | "LOCATION_CONTRADICTION"
  | "LOCATION_REVIEW"
  | "UNUSABLE_PROJECTION";
export interface AttentionGateResult {
  decision: AttentionDecision;
  eligibility: EligibilityDecision;
  reasons: string[];
  reasonCodes: EligibilityReasonCode[];
  matchedConcepts: string[];
  locationPolicy?: LocationEligibilityPolicy;
  locationEvidence?: string | null;
}

const normalize = (value: string | null | undefined) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const includesConcept = (text: string, concepts: readonly string[]) =>
  concepts.some((concept) => {
    const value = normalize(concept);
    return value.length > 1 && ` ${normalize(text)} `.includes(` ${value} `);
  });
const hasAny = (text: string, words: readonly string[]) =>
  words.some((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );

function fallbackSpec(criteria: SearchCriteriaPayload): EligibilitySpec {
  const functions = Array.isArray(criteria.customParameters?.functions)
    ? criteria.customParameters!.functions.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const roleFamilies = criteria.targetRoles || [];
  const inferredSeniority = roleFamilies.flatMap((role) =>
    /chief|cto|cmo|cfo/i.test(role)
      ? ["Chief"]
      : /vice president|\bvp\b|svp|evp/i.test(role)
        ? ["VP"]
        : /director/i.test(role)
          ? ["Director"]
          : /head/i.test(role)
            ? ["Head"]
            : [],
  );
  return {
    version: "eligibility-spec/v1",
    ontologyVersion: "legacy-criteria/v1",
    roleFamilies,
    functions,
    seniorityRange: Array.from(
      new Set([...(criteria.targetSeniority || []), ...inferredSeniority]),
    ),
    locations: criteria.targetLocations || [],
    industries: criteria.targetIndustries || [],
    adjacentFamilies: [],
    excludedCompanies: criteria.excludedCompanies || [],
  };
}
function projectionConceptText(version: OpportunityVersion, projection?: JobProjection): string {
  if (!projection) return version.jobTitle;
  return [
    projection.role,
    projection.executiveIdentity?.value,
    ...(projection.executiveFunction || []),
    ...(projection.capabilities || []).map(
      (capability) => capability.canonicalConcept || capability.name,
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

const REMOTE_TOKENS = ["remote", "work from home", "wfh", "anywhere"];
const isLocationKnown = (value: string) =>
  Boolean(value.trim()) && !/^(unknown|unspecified|india)$/i.test(value.trim());
const isRemoteCompatible = (value: string, projection?: JobProjection) =>
  projection?.workModel === "REMOTE" ||
  projection?.workModel === "HYBRID" ||
  REMOTE_TOKENS.some((token) => normalize(value).includes(token));
const allowsIndiaRemote = (locations: readonly string[]) =>
  locations.some((location) => {
    const normalized = normalize(location);
    return normalized.includes("remote") && normalized.includes("india");
  });

/** Explicit JD requirements outrank broad lexical role-family matches. */
function explicitExperienceRange(text: string): { min: number; max: number } | null {
  const ranges = [
    // "1–3 years of sales experience" and equivalent role-qualified wording.
    /\b(\d{1,2})\s*(?:-|–|\uFFFD|to)\s*(\d{1,2})(?:\s*[\]\)])?\s*(?:years?|yrs?)\b(?:[^.]{0,70}?)\bexperience\b/i,
    // "Experience: 2–3 Years" is a common portal/JD field layout.
    /(?:\bexperience|(?<=month)experience)(?:\s+(?:required|range))?\s*:?\s*(\d{1,2})\s*(?:-|–|\uFFFD|to)\s*(\d{1,2})(?:\s*[\]\)])?\s*(?:years?|yrs?)(?:\b|(?=key\b|responsibilities\b|location\b|salary\b|required\b))/i,
  ];
  for (const range of ranges) {
    const match = text.match(range);
    if (match) return { min: Number(match[1]), max: Number(match[2]) };
  }
  const maximum = text.match(
    /\b(?:up\s+to|maximum\s+of)\s*(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:(?:[a-z&/-]+\s+){0,4})experience\b/i,
  );
  return maximum ? { min: 0, max: Number(maximum[1]) } : null;
}

/**
 * The immutable EligibilitySpec expresses the target executive range. These
 * are policy floors for the target level, not a mutable read of a profile at
 * evaluation time. A JD whose explicit maximum is below the target floor is
 * a contradiction even when its title happens to contain an executive word.
 */
function minimumTargetExperienceYears(seniorityRange: readonly string[]): number | null {
  const text = seniorityRange.join(" ").toLowerCase();
  if (/chief|c-suite|c suite/.test(text)) return 15;
  if (/\bevp\b|executive vice president|\bsvp\b|senior vice president/.test(text)) return 14;
  if (/\bvp\b|vice president/.test(text)) return 12;
  if (/director/.test(text)) return 9;
  if (/head|lead/.test(text)) return 8;
  return null;
}

const SENIORITY_RANK: Readonly<Record<SeniorityBand, number>> = {
  UNKNOWN: 0,
  COORDINATOR_ENTRY: 1,
  INDIVIDUAL_CONTRIBUTOR: 2,
  MANAGER: 3,
  LEAD: 3,
  DIRECTOR: 4,
  HEAD: 4,
  VP: 5,
  C_SUITE: 6,
};

function targetSeniorityFloor(seniorityRange: readonly string[]): SeniorityBand | null {
  const bands = seniorityRange
    .map((value): SeniorityBand => {
      const normalized = normalize(value);
      if (/\bchief\b|\bc suite\b/.test(normalized)) return "C_SUITE";
      if (/\bevp\b|\bsvp\b|\bvp\b|vice president/.test(normalized)) return "VP";
      if (/\bhead\b/.test(normalized)) return "HEAD";
      if (/\bdirector\b/.test(normalized)) return "DIRECTOR";
      if (/\blead\b/.test(normalized)) return "LEAD";
      if (/\bmanager\b/.test(normalized)) return "MANAGER";
      return SeniorityResolver.resolve(value).seniorityBand;
    })
    .filter((band) => band !== "UNKNOWN");
  if (bands.length === 0) return null;
  return bands.reduce((floor, band) =>
    SENIORITY_RANK[band] < SENIORITY_RANK[floor] ? band : floor,
  );
}

function titleSeniorityAssessment(
  title: string,
  targetRange: readonly string[],
): { kind: "NONE" | "REVIEW" | "REJECT"; reason?: string } {
  const target = targetSeniorityFloor(targetRange);
  if (!target) return { kind: "NONE" };

  const resolved = SeniorityResolver.resolve(title);
  if (resolved.seniorityBand === "UNKNOWN" || resolved.confidence < 0.9) {
    return {
      kind: "REVIEW",
      reason: `Title '${title}' does not establish seniority confidently enough for the configured ${target} floor.`,
    };
  }

  const gap = SENIORITY_RANK[target] - SENIORITY_RANK[resolved.seniorityBand];
  if (gap >= 2) {
    return {
      kind: "REJECT",
      reason: `Title '${title}' resolves to ${resolved.seniorityBand}, materially below the configured ${target} floor.`,
    };
  }
  if (gap === 1) {
    return {
      kind: "REVIEW",
      reason: `Title '${title}' resolves one seniority band below the configured ${target} floor.`,
    };
  }
  return { kind: "NONE" };
}

function resolveLocationPolicy(
  version: OpportunityVersion,
  projection: JobProjection | undefined,
  policy: LocationEligibilityPolicy | undefined,
  configuredLocations: readonly string[],
): Pick<
  AttentionGateResult,
  "decision" | "eligibility" | "reasons" | "reasonCodes" | "locationPolicy" | "locationEvidence"
> | null {
  // Legacy immutable contexts retain their established behavior until a newly
  // activated context explicitly declares a serving geography.
  if (!policy || policy === "NATIONWIDE") return null;
  const evidence = projection?.location || version.location || null;
  if (!evidence || !isLocationKnown(evidence)) {
    return {
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasons: ["Location evidence is unavailable for the configured serving geography."],
      reasonCodes: ["LOCATION_REVIEW"],
      locationPolicy: policy,
      locationEvidence: evidence,
    };
  }
  const remote = isRemoteCompatible(evidence, projection);
  const indiaRemote = remote && /\bindia\b/i.test(evidence);
  const remoteIndiaAllowed = allowsIndiaRemote(configuredLocations);
  const accepted =
    policy === "GURUGRAM_ONLY"
      ? (GeographyResolver.isNcrLocation(evidence) && /gurugram|gurgaon/i.test(evidence)) ||
        (remoteIndiaAllowed && indiaRemote)
      : policy === "NCR"
        ? GeographyResolver.isNcrLocation(evidence) || (remoteIndiaAllowed && indiaRemote)
        : policy === "REMOTE_COMPATIBLE"
          ? GeographyResolver.isNcrLocation(evidence) || remote
          : true;
  if (accepted) return null;
  if (remote && remoteIndiaAllowed) {
    return {
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasons: [
        `Remote location '${evidence}' requires confirmation against the configured Remote India target.`,
      ],
      reasonCodes: ["LOCATION_REVIEW"],
      locationPolicy: policy,
      locationEvidence: evidence,
    };
  }
  // Hybrid is a work model, not a geography override. Only an explicitly
  // remote-compatible context may retain an out-of-area remote/hybrid role
  // for review; NCR and Gurugram-only contexts reject it deterministically.
  if (remote && policy === "REMOTE_COMPATIBLE") {
    return {
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasons: [
        `Remote/hybrid location '${evidence}' requires confirmation against the configured ${policy} policy.`,
      ],
      reasonCodes: ["LOCATION_REVIEW"],
      locationPolicy: policy,
      locationEvidence: evidence,
    };
  }
  return {
    decision: "NOT_CANDIDATE",
    eligibility: "INELIGIBLE",
    reasons: [`Location '${evidence}' contradicts the configured ${policy} serving geography.`],
    reasonCodes: ["LOCATION_CONTRADICTION"],
    locationPolicy: policy,
    locationEvidence: evidence,
  };
}

/** Maps tri-state eligibility onto existing binary candidate storage. */
export function evaluateAttentionGate(
  version: OpportunityVersion,
  criteria: SearchCriteriaPayload,
  projection?: JobProjection,
): AttentionGateResult {
  const spec = criteria.eligibilitySpec || fallbackSpec(criteria);
  const title = version.jobTitle || "";
  const roleText = projectionConceptText(version, projection);
  const matchedConcepts: string[] = [];
  const locationEvidence = projection?.location || version.location || null;
  const withLocation = (result: AttentionGateResult): AttentionGateResult =>
    spec.locationPolicy
      ? { ...result, locationPolicy: spec.locationPolicy, locationEvidence }
      : result;
  const reject = (code: EligibilityReasonCode, reason: string): AttentionGateResult =>
    withLocation({
      decision: "NOT_CANDIDATE",
      eligibility: "INELIGIBLE",
      reasons: [reason],
      reasonCodes: [code],
      matchedConcepts,
    });
  if (
    ["CAPTURE_FAILED", "RECOVERY_PENDING", "RECOVERY_FAILED"].includes(
      version.acquisitionStatus || "",
    )
  )
    return reject("UNUSABLE_PROJECTION", "Acquisition is not usable for eligibility.");
  if (version.companyName && includesConcept(version.companyName, spec.excludedCompanies))
    return reject("EXCLUDED_COMPANY", `Company '${version.companyName}' is explicitly excluded.`);
  if (
    criteria.targetEmploymentTypes?.length &&
    version.employmentType &&
    !includesConcept(version.employmentType, criteria.targetEmploymentTypes)
  )
    return reject(
      "EMPLOYMENT_CONTRADICTION",
      `Employment type '${version.employmentType}' contradicts an explicit constraint.`,
    );
  const locationResult = resolveLocationPolicy(
    version,
    projection,
    spec.locationPolicy,
    spec.locations,
  );
  if (locationResult) return { ...locationResult, matchedConcepts };
  const seniority = titleSeniorityAssessment(title, spec.seniorityRange);
  const requiredExperience = minimumTargetExperienceYears(spec.seniorityRange);
  const jobExperience = explicitExperienceRange(version.rawContent || "");
  if (requiredExperience !== null && jobExperience && jobExperience.max < requiredExperience) {
    return reject(
      "SENIORITY_CONTRADICTION",
      `The job description explicitly caps experience at ${jobExperience.max} years, below the configured ${requiredExperience}+ year executive range.`,
    );
  }
  const wantedCommercial = hasAny([...spec.functions, ...spec.roleFamilies].join(" "), [
    "marketing",
    "growth",
    "commercial",
    "revenue",
    "sales",
  ]);
  const explicitTechnical = hasAny(title, [
    "technology",
    "engineering",
    "engineer",
    "software",
    "java",
    "microservices",
    "devops",
    "architecture",
    "ai engineer",
    "finance",
    "human resources",
    "hr",
    "audit",
    "civil",
    "insurance",
  ]);
  if (
    wantedCommercial &&
    explicitTechnical &&
    !hasAny(title, ["digital transformation", "strategy", "client experience", "client services"])
  )
    return withLocation({
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasons: [`Title '${title}' suggests a different function; evaluate the actual mandate.`],
      reasonCodes: ["FUNCTION_REVIEW"],
      matchedConcepts,
    });
  const intelligence = readPinnedIntelligence(criteria.customParameters?.intelligenceTaxonomy);
  if (intelligence) {
    const desired = matchIntelligence(
      intelligence.definition,
      [...spec.functions, ...spec.roleFamilies].join(" "),
    );
    const scope = new Set(desired.map((n) => n.id));
    for (let i = 0; i < 3; i++)
      for (const node of intelligence.definition.nodes)
        if (node.parentId && scope.has(node.parentId)) scope.add(node.id);
    const matches = matchIntelligence(
      intelligence.definition,
      `${roleText} ${version.rawContent ?? ""}`,
    ).filter((n) => scope.has(n.id));
    if (matches.length) {
      matchedConcepts.push(...matches.map((n) => n.id));
      return withLocation({
        decision: "CANDIDATE",
        eligibility: "REVIEW",
        reasonCodes: [
          matches.some((n) => n.classification === "CORE")
            ? "ROLE_FAMILY_MATCH"
            : "ADJACENT_ROLE_FAMILY",
        ],
        reasons: [
          "Taxonomy signals are indicative; evaluate the evidenced mandate and candidate fit.",
        ],
        matchedConcepts,
      });
    }
  }
  if (includesConcept(roleText, spec.roleFamilies) || includesConcept(roleText, spec.functions)) {
    matchedConcepts.push(
      ...[...spec.roleFamilies, ...spec.functions].filter((concept) =>
        includesConcept(roleText, [concept]),
      ),
    );
    return withLocation({
      decision: "CANDIDATE",
      eligibility: seniority.kind !== "NONE" ? "REVIEW" : "ELIGIBLE",
      reasons: seniority.kind !== "NONE" && seniority.reason ? [seniority.reason] : [],
      reasonCodes: seniority.kind !== "NONE" ? ["SENIORITY_REVIEW"] : ["ROLE_FAMILY_MATCH"],
      matchedConcepts,
    });
  }
  if (includesConcept(roleText, spec.adjacentFamilies)) {
    matchedConcepts.push(
      ...spec.adjacentFamilies.filter((concept) => includesConcept(roleText, [concept])),
    );
    return withLocation({
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasons: ["Adjacent role family requires evaluation."],
      reasonCodes: ["ADJACENT_ROLE_FAMILY"],
      matchedConcepts,
    });
  }
  return withLocation({
    decision: "CANDIDATE",
    eligibility: "REVIEW",
    reasons: ["Role equivalence is unknown; no hard contradiction is demonstrated."],
    reasonCodes: ["ROLE_UNKNOWN"],
    matchedConcepts,
  });
}
