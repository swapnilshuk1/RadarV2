/** Deterministic eligibility boundary; it schedules evaluation, never scores. */
import type { OpportunityVersion, AttentionDecision } from "@/lib/domain/canonical_acquisition";
import type { EligibilitySpec, LocationEligibilityPolicy, SearchCriteriaPayload } from "@/lib/domain/evaluation_context";
import type { JobProjection } from "@/lib/domain/job_projection";

export type EligibilityDecision = "ELIGIBLE" | "REVIEW" | "INELIGIBLE";
export type EligibilityReasonCode = "ROLE_FAMILY_MATCH" | "ADJACENT_ROLE_FAMILY" | "ROLE_UNKNOWN" | "EXCLUDED_COMPANY" | "FUNCTION_CONTRADICTION" | "SENIORITY_CONTRADICTION" | "EMPLOYMENT_CONTRADICTION" | "LOCATION_CONTRADICTION" | "LOCATION_REVIEW" | "UNUSABLE_PROJECTION";
export interface AttentionGateResult { decision: AttentionDecision; eligibility: EligibilityDecision; reasons: string[]; reasonCodes: EligibilityReasonCode[]; matchedConcepts: string[]; locationPolicy?: LocationEligibilityPolicy; locationEvidence?: string | null; }

const normalize = (value: string | null | undefined) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const includesConcept = (text: string, concepts: readonly string[]) => concepts.some((concept) => { const value = normalize(concept); return value.length > 1 && (` ${normalize(text)} `).includes(` ${value} `); });
const hasAny = (text: string, words: readonly string[]) => words.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

function fallbackSpec(criteria: SearchCriteriaPayload): EligibilitySpec {
  const functions = Array.isArray(criteria.customParameters?.functions) ? criteria.customParameters!.functions.filter((value): value is string => typeof value === "string") : [];
  const roleFamilies = criteria.targetRoles || [];
  const inferredSeniority = roleFamilies.flatMap((role) => /chief|cto|cmo|cfo/i.test(role) ? ["Chief"] : /vice president|\bvp\b|svp|evp/i.test(role) ? ["VP"] : /director/i.test(role) ? ["Director"] : /head/i.test(role) ? ["Head"] : []);
  return { version: "eligibility-spec/v1", ontologyVersion: "legacy-criteria/v1", roleFamilies, functions, seniorityRange: Array.from(new Set([...(criteria.targetSeniority || []), ...inferredSeniority])), locations: criteria.targetLocations || [], industries: criteria.targetIndustries || [], adjacentFamilies: [], excludedCompanies: criteria.excludedCompanies || [] };
}
function projectionConceptText(version: OpportunityVersion, projection?: JobProjection): string {
  if (!projection) return version.jobTitle;
  return [projection.role, projection.executiveIdentity?.value, ...(projection.executiveFunction || []), ...(projection.capabilities || []).map((capability) => capability.canonicalConcept || capability.name)].filter(Boolean).join(" ");
}

const NCR_TOKENS = ["gurugram", "gurgaon", "new delhi", "delhi", "noida", "greater noida", "ghaziabad", "faridabad"];
const REMOTE_TOKENS = ["remote", "work from home", "wfh", "anywhere"];
const isLocationKnown = (value: string) => Boolean(value.trim()) && !/^(unknown|unspecified|india)$/i.test(value.trim());
const isNcr = (value: string) => NCR_TOKENS.some((token) => normalize(value).includes(token));
const isRemoteCompatible = (value: string, projection?: JobProjection) =>
  projection?.workModel === "REMOTE" || projection?.workModel === "HYBRID" || REMOTE_TOKENS.some((token) => normalize(value).includes(token));

function resolveLocationPolicy(
  version: OpportunityVersion,
  projection: JobProjection | undefined,
  policy: LocationEligibilityPolicy | undefined,
): Pick<AttentionGateResult, "decision" | "eligibility" | "reasons" | "reasonCodes" | "locationPolicy" | "locationEvidence"> | null {
  // Legacy immutable contexts retain their established behavior until a newly
  // activated context explicitly declares a serving geography.
  if (!policy || policy === "NATIONWIDE") return null;
  const evidence = projection?.location || version.location || null;
  if (!evidence || !isLocationKnown(evidence)) {
    return { decision: "CANDIDATE", eligibility: "REVIEW", reasons: ["Location evidence is unavailable for the configured serving geography."], reasonCodes: ["LOCATION_REVIEW"], locationPolicy: policy, locationEvidence: evidence };
  }
  const remote = isRemoteCompatible(evidence, projection);
  const accepted = policy === "GURUGRAM_ONLY"
    ? isNcr(evidence) && /gurugram|gurgaon/i.test(evidence)
    : policy === "NCR"
      ? isNcr(evidence)
      : policy === "REMOTE_COMPATIBLE"
        ? isNcr(evidence) || remote
        : true;
  if (accepted) return null;
  // Hybrid is a work model, not a geography override. Only an explicitly
  // remote-compatible context may retain an out-of-area remote/hybrid role
  // for review; NCR and Gurugram-only contexts reject it deterministically.
  if (remote && policy === "REMOTE_COMPATIBLE") {
    return { decision: "CANDIDATE", eligibility: "REVIEW", reasons: [`Remote/hybrid location '${evidence}' requires confirmation against the configured ${policy} policy.`], reasonCodes: ["LOCATION_REVIEW"], locationPolicy: policy, locationEvidence: evidence };
  }
  return { decision: "NOT_CANDIDATE", eligibility: "INELIGIBLE", reasons: [`Location '${evidence}' contradicts the configured ${policy} serving geography.`], reasonCodes: ["LOCATION_CONTRADICTION"], locationPolicy: policy, locationEvidence: evidence };
}

/** Maps tri-state eligibility onto existing binary candidate storage. */
export function evaluateAttentionGate(version: OpportunityVersion, criteria: SearchCriteriaPayload, projection?: JobProjection): AttentionGateResult {
  const spec = criteria.eligibilitySpec || fallbackSpec(criteria);
  const title = version.jobTitle || "";
  const roleText = projectionConceptText(version, projection);
  const matchedConcepts: string[] = [];
  const locationEvidence = projection?.location || version.location || null;
  const withLocation = (result: AttentionGateResult): AttentionGateResult => spec.locationPolicy
    ? { ...result, locationPolicy: spec.locationPolicy, locationEvidence }
    : result;
  const reject = (code: EligibilityReasonCode, reason: string): AttentionGateResult => withLocation({ decision: "NOT_CANDIDATE", eligibility: "INELIGIBLE", reasons: [reason], reasonCodes: [code], matchedConcepts });
  if (["CAPTURE_FAILED", "RECOVERY_PENDING", "RECOVERY_FAILED"].includes(version.acquisitionStatus || "")) return reject("UNUSABLE_PROJECTION", "Acquisition is not usable for eligibility.");
  if (version.companyName && includesConcept(version.companyName, spec.excludedCompanies)) return reject("EXCLUDED_COMPANY", `Company '${version.companyName}' is explicitly excluded.`);
  if (criteria.targetEmploymentTypes?.length && version.employmentType && !includesConcept(version.employmentType, criteria.targetEmploymentTypes)) return reject("EMPLOYMENT_CONTRADICTION", `Employment type '${version.employmentType}' contradicts an explicit constraint.`);
  const locationResult = resolveLocationPolicy(version, projection, spec.locationPolicy);
  if (locationResult) return { ...locationResult, matchedConcepts };
  const junior = hasAny(title, ["intern", "assistant", "associate", "manager", "analyst", "engineer", "developer"]);
  const executive = hasAny(title, ["chief", "vice president", "vp", "director", "head", "svp", "evp"]);
  if (spec.seniorityRange.length && junior && !executive) return reject("SENIORITY_CONTRADICTION", `Title '${title}' is materially below the configured executive range.`);
  const wantedCommercial = hasAny([...spec.functions, ...spec.roleFamilies].join(" "), ["marketing", "growth", "commercial", "revenue", "sales"]);
  const explicitTechnical = hasAny(title, ["technology", "engineering", "software", "finance", "human resources", "hr", "audit", "civil", "insurance"]);
  if (wantedCommercial && explicitTechnical && !hasAny(title, ["digital transformation", "strategy", "client experience", "client services"])) return reject("FUNCTION_CONTRADICTION", `Title '${title}' states an explicitly incompatible function.`);
  if (includesConcept(roleText, spec.roleFamilies) || includesConcept(roleText, spec.functions)) {
    matchedConcepts.push(...[...spec.roleFamilies, ...spec.functions].filter((concept) => includesConcept(roleText, [concept])));
    return withLocation({ decision: "CANDIDATE", eligibility: "ELIGIBLE", reasons: [], reasonCodes: ["ROLE_FAMILY_MATCH"], matchedConcepts });
  }
  if (includesConcept(roleText, spec.adjacentFamilies)) {
    matchedConcepts.push(...spec.adjacentFamilies.filter((concept) => includesConcept(roleText, [concept])));
    return withLocation({ decision: "CANDIDATE", eligibility: "REVIEW", reasons: ["Adjacent role family requires evaluation."], reasonCodes: ["ADJACENT_ROLE_FAMILY"], matchedConcepts });
  }
  return withLocation({ decision: "CANDIDATE", eligibility: "REVIEW", reasons: ["Role equivalence is unknown; no hard contradiction is demonstrated."], reasonCodes: ["ROLE_UNKNOWN"], matchedConcepts });
}
