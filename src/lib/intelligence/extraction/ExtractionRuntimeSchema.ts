import type { CandidateProofOutputV1 } from "./CandidateProofExtractorV1";
import type { RoleIntelligenceOutputV1 } from "./RoleIntelligenceExtractorV1";

const roleSemanticTypes = [
  "ROLE_PURPOSE", "RESPONSIBILITY", "OUTCOME", "SUCCESS_METRIC", "HARD_REQUIREMENT",
  "PREFERRED_REQUIREMENT", "REPORTING_LINE", "FOUNDER_CEO_PROXIMITY", "BOARD_EXPOSURE",
  "PNL_OWNERSHIP", "REVENUE_ACCOUNTABILITY", "PROFITABILITY_ACCOUNTABILITY", "BUDGET_SCOPE",
  "DECISION_AUTHORITY", "PEOPLE_LEADERSHIP", "PEOPLE_SCALE", "GREENFIELD_BUILD",
  "TRANSFORMATION", "GEOGRAPHIC_SCOPE", "REGULATORY_SCOPE", "PRODUCT_SCOPE", "CUSTOMER_SCOPE",
  "CHANNEL_SCOPE", "COMPANY_CONTEXT", "WORK_CONDITION",
] as const;
const sectionTypes = [
  "ABOUT_COMPANY", "ROLE_OVERVIEW", "RESPONSIBILITIES", "REQUIREMENTS", "PREFERRED", "SUCCESS",
  "WHO_YOU_WORK_WITH", "WHY_JOIN", "BENEFITS", "APPLICATION", "LEGAL_EEO", "STRUCTURAL_METADATA", "OTHER",
] as const;
const roleSubjects = ["ROLE", "COMPANY", "RECRUITING_PROCESS"] as const;
const extractionMethods = [
  "DETERMINISTIC_SECTION", "DETERMINISTIC_META_LINE", "DETERMINISTIC_PROPOSITION_RULE", "SEMANTIC_FALLBACK",
] as const;
const requirementDimensions = [
  "EXPERIENCE_YEARS", "INDUSTRY", "DOMAIN", "CAPABILITY", "EDUCATION", "CERTIFICATION", "TECHNOLOGY",
  "GEOGRAPHY", "WORK_AUTHORIZATION", "LICENCE", "PORTFOLIO", "OTHER",
] as const;
const proofTypes = [
  "OUTCOME", "OWNERSHIP", "FINANCIAL_SCOPE", "PEOPLE_SCOPE", "GEOGRAPHIC_SCOPE", "ORGANIZATION_BUILD",
  "TRANSFORMATION", "MANDATE", "PRODUCT_LAUNCH", "CUSTOMER_GROWTH", "REVENUE_GROWTH", "COST_EFFICIENCY",
  "PIPELINE_GENERATION", "TECHNOLOGY_IMPLEMENTATION", "PARTNERSHIP", "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT", "CAPABILITY_LABEL",
] as const;
const metricTypes = [
  "CURRENCY_AMOUNT", "PERCENTAGE_CHANGE", "PERCENTAGE_VALUE", "PEOPLE_COUNT", "MARKET_COUNT",
  "LOCATION_COUNT", "LEAD_COUNT", "TIMELINE", "COUNT",
] as const;
const metricComparators = ["EXACT", "AT_LEAST", "MORE_THAN", "APPROXIMATELY", "RANGE"] as const;
const entityCategories = ["COMPANY", "PRODUCT", "PLATFORM", "MARKET", "CLIENT", "BRAND", "GEOGRAPHY", "ORGANIZATION"] as const;

export class ExtractionRuntimeSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionRuntimeSchemaError";
  }
}

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const requireRecord = (value: unknown, label: string): RecordValue => {
  if (!isRecord(value)) throw new ExtractionRuntimeSchemaError(`${label} must be an object.`);
  return value;
};
const requireArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new ExtractionRuntimeSchemaError(`${label} must be an array.`);
  return value;
};
const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new ExtractionRuntimeSchemaError(`${label} must be a string.`);
  return value;
};
const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new ExtractionRuntimeSchemaError(`${label} must be a boolean.`);
  return value;
};
const requireFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ExtractionRuntimeSchemaError(`${label} must be a finite number.`);
  return value;
};
const optionalString = (value: unknown, label: string): void => {
  if (value !== undefined && value !== null) requireString(value, label);
};
const optionalFiniteNumber = (value: unknown, label: string): void => {
  if (value !== undefined) requireFiniteNumber(value, label);
};
const requireEnum = (value: unknown, choices: readonly string[], label: string): void => {
  if (typeof value !== "string" || !choices.includes(value)) throw new ExtractionRuntimeSchemaError(`${label} has an invalid enum value.`);
};
const exactKeys = (record: RecordValue, keys: readonly string[], label: string): void => {
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new ExtractionRuntimeSchemaError(`${label} contains an unknown field: ${key}.`);
};

function verifyMetric(value: unknown, label: string): void {
  const metric = requireRecord(value, label);
  exactKeys(metric, ["exactText", "startOffset", "endOffset", "metricType", "rawValue", "normalizedValue", "comparator", "currency", "scale", "unit", "direction", "changeValue", "baselineValue", "endValue", "timeframe", "linkedObject"], label);
  requireString(metric.exactText, `${label}.exactText`);
  requireFiniteNumber(metric.startOffset, `${label}.startOffset`);
  requireFiniteNumber(metric.endOffset, `${label}.endOffset`);
  requireEnum(metric.metricType, metricTypes, `${label}.metricType`);
  requireString(metric.rawValue, `${label}.rawValue`);
  requireFiniteNumber(metric.normalizedValue, `${label}.normalizedValue`);
  requireEnum(metric.comparator, metricComparators, `${label}.comparator`);
  if (metric.currency !== undefined) requireEnum(metric.currency, ["USD", "INR", "SGD", "EUR", "GBP"], `${label}.currency`);
  if (metric.scale !== undefined) requireEnum(metric.scale, ["THOUSAND", "MILLION", "CRORE", "BILLION", "UNIT"], `${label}.scale`);
  optionalString(metric.unit, `${label}.unit`); optionalString(metric.timeframe, `${label}.timeframe`); optionalString(metric.linkedObject, `${label}.linkedObject`);
  if (metric.direction !== undefined) requireEnum(metric.direction, ["INCREASE", "DECREASE", "STATIC"], `${label}.direction`);
  optionalFiniteNumber(metric.changeValue, `${label}.changeValue`); optionalFiniteNumber(metric.baselineValue, `${label}.baselineValue`); optionalFiniteNumber(metric.endValue, `${label}.endValue`);
}

function verifyEntity(value: unknown, label: string): void {
  const entity = requireRecord(value, label);
  exactKeys(entity, ["exactText", "startOffset", "endOffset", "category"], label);
  requireString(entity.exactText, `${label}.exactText`); requireFiniteNumber(entity.startOffset, `${label}.startOffset`); requireFiniteNumber(entity.endOffset, `${label}.endOffset`);
  requireEnum(entity.category, entityCategories, `${label}.category`);
}

function verifyClaim(value: unknown, label: string): void {
  const claim = requireRecord(value, label);
  exactKeys(claim, ["claimId", "sourceDocumentId", "positionId", "title", "employer", "dates", "parentBulletExactText", "parentBulletStartOffset", "parentBulletEndOffset", "exactText", "startOffset", "endOffset", "evidenceClass", "proofTypes", "metrics", "groundedEntities"], label);
  for (const key of ["claimId", "sourceDocumentId", "parentBulletExactText", "exactText"] as const) requireString(claim[key], `${label}.${key}`);
  for (const key of ["parentBulletStartOffset", "parentBulletEndOffset", "startOffset", "endOffset"] as const) requireFiniteNumber(claim[key], `${label}.${key}`);
  for (const key of ["positionId", "title", "employer", "dates"] as const) optionalString(claim[key], `${label}.${key}`);
  requireEnum(claim.evidenceClass, ["WORK_HISTORY", "SELF_SUMMARY", "CAPABILITY_LABEL"], `${label}.evidenceClass`);
  const types = requireArray(claim.proofTypes, `${label}.proofTypes`); if (types.length === 0) throw new ExtractionRuntimeSchemaError(`${label}.proofTypes cannot be empty.`); types.forEach((item, index) => requireEnum(item, proofTypes, `${label}.proofTypes[${index}]`));
  requireArray(claim.metrics, `${label}.metrics`).forEach((item, index) => verifyMetric(item, `${label}.metrics[${index}]`));
  requireArray(claim.groundedEntities, `${label}.groundedEntities`).forEach((item, index) => verifyEntity(item, `${label}.groundedEntities[${index}]`));
}

/** Strict shape gate for the experimental LLM boundary. Relational checks live in MechanicalExtractionVerifier. */
export function parseCandidateProofOutputV1(value: unknown): CandidateProofOutputV1 {
  const output = requireRecord(value, "CandidateProofOutputV1");
  exactKeys(output, ["sourceDocumentId", "rawDocumentLength", "masthead", "positions", "selfSummaries", "capabilityLabels", "education", "allBullets", "allClaims", "metadata"], "CandidateProofOutputV1");
  requireString(output.sourceDocumentId, "CandidateProofOutputV1.sourceDocumentId"); requireFiniteNumber(output.rawDocumentLength, "CandidateProofOutputV1.rawDocumentLength");
  if (output.masthead !== undefined) { const masthead = requireRecord(output.masthead, "masthead"); exactKeys(masthead, ["rawText", "startOffset", "endOffset"], "masthead"); requireString(masthead.rawText, "masthead.rawText"); requireFiniteNumber(masthead.startOffset, "masthead.startOffset"); requireFiniteNumber(masthead.endOffset, "masthead.endOffset"); }
  requireArray(output.positions, "positions").forEach((item, index) => { const position = requireRecord(item, `positions[${index}]`); exactKeys(position, ["positionId", "title", "employer", "dates", "startOffset", "endOffset", "isCurrent", "bullets"], `positions[${index}]`); for (const key of ["positionId", "title", "employer", "dates"] as const) requireString(position[key], `positions[${index}].${key}`); requireFiniteNumber(position.startOffset, `positions[${index}].startOffset`); requireFiniteNumber(position.endOffset, `positions[${index}].endOffset`); requireBoolean(position.isCurrent, `positions[${index}].isCurrent`); requireArray(position.bullets, `positions[${index}].bullets`).forEach((bullet, bulletIndex) => verifyBullet(bullet, `positions[${index}].bullets[${bulletIndex}]`)); });
  requireArray(output.selfSummaries, "selfSummaries").forEach((item, index) => verifyClaim(item, `selfSummaries[${index}]`));
  requireArray(output.capabilityLabels, "capabilityLabels").forEach((item, index) => verifyClaim(item, `capabilityLabels[${index}]`));
  requireArray(output.education, "education").forEach((item, index) => { const education = requireRecord(item, `education[${index}]`); exactKeys(education, ["degree", "institution", "year", "rawText", "startOffset", "endOffset"], `education[${index}]`); requireString(education.degree, `education[${index}].degree`); requireString(education.institution, `education[${index}].institution`); optionalString(education.year, `education[${index}].year`); requireString(education.rawText, `education[${index}].rawText`); requireFiniteNumber(education.startOffset, `education[${index}].startOffset`); requireFiniteNumber(education.endOffset, `education[${index}].endOffset`); });
  requireArray(output.allBullets, "allBullets").forEach((item, index) => verifyBullet(item, `allBullets[${index}]`));
  requireArray(output.allClaims, "allClaims").forEach((item, index) => verifyClaim(item, `allClaims[${index}]`));
  const metadata = requireRecord(output.metadata, "metadata"); exactKeys(metadata, ["extractorVersion", "totalProfessionalExperienceBullets", "bulletsRetained", "bulletsWithSpecializedClaims", "bulletsWithoutSpecializedClaims", "proposalCounts"], "metadata"); if (metadata.extractorVersion !== "CandidateProofExtractorV1") throw new ExtractionRuntimeSchemaError("CandidateProofOutputV1.metadata.extractorVersion is invalid."); for (const key of ["totalProfessionalExperienceBullets", "bulletsRetained", "bulletsWithSpecializedClaims", "bulletsWithoutSpecializedClaims"] as const) requireFiniteNumber(metadata[key], `metadata.${key}`); const counts = requireRecord(metadata.proposalCounts, "metadata.proposalCounts"); exactKeys(counts, ["proposedClaims", "acceptedClaims", "rejectedClaims"], "metadata.proposalCounts"); for (const key of ["proposedClaims", "acceptedClaims", "rejectedClaims"] as const) requireFiniteNumber(counts[key], `metadata.proposalCounts.${key}`);
  return output as unknown as CandidateProofOutputV1;
}

function verifyBullet(value: unknown, label: string): void {
  const bullet = requireRecord(value, label); exactKeys(bullet, ["bulletId", "exactText", "startOffset", "endOffset", "claims"], label); requireString(bullet.bulletId, `${label}.bulletId`); requireString(bullet.exactText, `${label}.exactText`); requireFiniteNumber(bullet.startOffset, `${label}.startOffset`); requireFiniteNumber(bullet.endOffset, `${label}.endOffset`); requireArray(bullet.claims, `${label}.claims`).forEach((claim, index) => verifyClaim(claim, `${label}.claims[${index}]`));
}

export function parseRoleIntelligenceOutputV1(value: unknown): RoleIntelligenceOutputV1 {
  const output = requireRecord(value, "RoleIntelligenceOutputV1"); exactKeys(output, ["caseId", "canonicalJobId", "companyName", "title", "rawTextLength", "sections", "atoms", "metadata"], "RoleIntelligenceOutputV1"); requireString(output.caseId, "RoleIntelligenceOutputV1.caseId"); requireString(output.canonicalJobId, "RoleIntelligenceOutputV1.canonicalJobId"); optionalString(output.companyName, "RoleIntelligenceOutputV1.companyName"); optionalString(output.title, "RoleIntelligenceOutputV1.title"); requireFiniteNumber(output.rawTextLength, "RoleIntelligenceOutputV1.rawTextLength");
  requireArray(output.sections, "sections").forEach((item, index) => { const section = requireRecord(item, `sections[${index}]`); exactKeys(section, ["type", "headingText", "headingStart", "headingEnd", "contentStart", "contentEnd", "rawContent", "isSynthetic"], `sections[${index}]`); requireEnum(section.type, sectionTypes, `sections[${index}].type`); requireString(section.headingText, `sections[${index}].headingText`); for (const key of ["headingStart", "headingEnd", "contentStart", "contentEnd"] as const) requireFiniteNumber(section[key], `sections[${index}].${key}`); requireString(section.rawContent, `sections[${index}].rawContent`); if (section.isSynthetic !== undefined) requireBoolean(section.isSynthetic, `sections[${index}].isSynthetic`); });
  requireArray(output.atoms, "atoms").forEach((item, index) => { const atom = requireRecord(item, `atoms[${index}]`); exactKeys(atom, ["id", "exactText", "startOffset", "endOffset", "section", "subject", "semanticType", "confidence", "extractionMethod", "epistemicMarker", "normalizedClaim", "requirement", "actionRole"], `atoms[${index}]`); requireString(atom.id, `atoms[${index}].id`); requireString(atom.exactText, `atoms[${index}].exactText`); requireFiniteNumber(atom.startOffset, `atoms[${index}].startOffset`); requireFiniteNumber(atom.endOffset, `atoms[${index}].endOffset`); requireEnum(atom.section, sectionTypes, `atoms[${index}].section`); requireEnum(atom.subject, roleSubjects, `atoms[${index}].subject`); if (atom.semanticType !== undefined) requireEnum(atom.semanticType, roleSemanticTypes, `atoms[${index}].semanticType`); requireFiniteNumber(atom.confidence, `atoms[${index}].confidence`); requireEnum(atom.extractionMethod, extractionMethods, `atoms[${index}].extractionMethod`); if (atom.epistemicMarker !== "EXACT_SOURCE_STATEMENT") throw new ExtractionRuntimeSchemaError(`atoms[${index}].epistemicMarker is invalid.`); verifyRoleOptionalFields(atom, index); });
  const metadata = requireRecord(output.metadata, "metadata"); exactKeys(metadata, ["extractorVersion", "hasGluedHeadings", "hasStructuralMetaLines", "proposalCounts"], "metadata"); if (metadata.extractorVersion !== "RoleIntelligenceExtractorV1") throw new ExtractionRuntimeSchemaError("RoleIntelligenceOutputV1.metadata.extractorVersion is invalid."); requireBoolean(metadata.hasGluedHeadings, "metadata.hasGluedHeadings"); requireBoolean(metadata.hasStructuralMetaLines, "metadata.hasStructuralMetaLines"); const counts = requireRecord(metadata.proposalCounts, "metadata.proposalCounts"); exactKeys(counts, ["proposedAtoms", "acceptedAtoms", "rejectedAtoms"], "metadata.proposalCounts"); for (const key of ["proposedAtoms", "acceptedAtoms", "rejectedAtoms"] as const) requireFiniteNumber(counts[key], `metadata.proposalCounts.${key}`);
  return output as unknown as RoleIntelligenceOutputV1;
}

function verifyRoleOptionalFields(atom: RecordValue, index: number): void {
  if (atom.normalizedClaim !== undefined) { const normalized = requireRecord(atom.normalizedClaim, `atoms[${index}].normalizedClaim`); exactKeys(normalized, ["predicate", "object", "qualifiers"], `atoms[${index}].normalizedClaim`); optionalString(normalized.predicate, `atoms[${index}].normalizedClaim.predicate`); optionalString(normalized.object, `atoms[${index}].normalizedClaim.object`); if (normalized.qualifiers !== undefined) { const qualifiers = requireRecord(normalized.qualifiers, `atoms[${index}].normalizedClaim.qualifiers`); for (const key of ["peopleCount", "amount"] as const) optionalFiniteNumber(qualifiers[key], `atoms[${index}].normalizedClaim.qualifiers.${key}`); for (const key of ["metric", "timeframe", "currency", "rawCondition"] as const) optionalString(qualifiers[key], `atoms[${index}].normalizedClaim.qualifiers.${key}`); } }
  if (atom.requirement !== undefined) { const requirement = requireRecord(atom.requirement, `atoms[${index}].requirement`); exactKeys(requirement, ["materiality", "materialityCue", "requirementDimension", "parsedYears"], `atoms[${index}].requirement`); requireEnum(requirement.materiality, ["HARD", "PREFERRED", "UNSTATED"], `atoms[${index}].requirement.materiality`); if (requirement.materialityCue !== null) requireString(requirement.materialityCue, `atoms[${index}].requirement.materialityCue`); requireEnum(requirement.requirementDimension, requirementDimensions, `atoms[${index}].requirement.requirementDimension`); if (requirement.parsedYears !== undefined) { const years = requireRecord(requirement.parsedYears, `atoms[${index}].requirement.parsedYears`); exactKeys(years, ["minimum", "maximum", "exact"], `atoms[${index}].requirement.parsedYears`); optionalFiniteNumber(years.minimum, `atoms[${index}].requirement.parsedYears.minimum`); optionalFiniteNumber(years.maximum, `atoms[${index}].requirement.parsedYears.maximum`); optionalFiniteNumber(years.exact, `atoms[${index}].requirement.parsedYears.exact`); } }
  if (atom.actionRole !== undefined) { const action = requireRecord(atom.actionRole, `atoms[${index}].actionRole`); exactKeys(action, ["ownershipLevel", "targetOutcome", "metric"], `atoms[${index}].actionRole`); requireEnum(action.ownershipLevel, ["OWN", "LEAD", "EXECUTE", "COLLABORATE"], `atoms[${index}].actionRole.ownershipLevel`); if (action.targetOutcome !== undefined && action.targetOutcome !== null) requireString(action.targetOutcome, `atoms[${index}].actionRole.targetOutcome`); if (action.metric !== undefined && action.metric !== null) requireString(action.metric, `atoms[${index}].actionRole.metric`); }
}

/**
 * JSON-schema payloads sent to strict structured-output transports. The runtime
 * parsers above remain authoritative for the same shape; the common verifier
 * owns relational and source-truth checks.
 */
const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;
const nullableStringSchema = { type: ["string", "null"] } as const;
const entitySchema = { type: "object", additionalProperties: false, required: ["exactText", "startOffset", "endOffset", "category"], properties: { exactText: stringSchema, startOffset: numberSchema, endOffset: numberSchema, category: { enum: entityCategories } } } as const;
const metricSchema = { type: "object", additionalProperties: false, required: ["exactText", "startOffset", "endOffset", "metricType", "rawValue", "normalizedValue", "comparator"], properties: { exactText: stringSchema, startOffset: numberSchema, endOffset: numberSchema, metricType: { enum: metricTypes }, rawValue: stringSchema, normalizedValue: numberSchema, comparator: { enum: metricComparators }, currency: { enum: ["USD", "INR", "SGD", "EUR", "GBP"] }, scale: { enum: ["THOUSAND", "MILLION", "CRORE", "BILLION", "UNIT"] }, unit: stringSchema, direction: { enum: ["INCREASE", "DECREASE", "STATIC"] }, changeValue: numberSchema, baselineValue: numberSchema, endValue: numberSchema, timeframe: stringSchema, linkedObject: stringSchema } } as const;
const claimSchema = { type: "object", additionalProperties: false, required: ["claimId", "sourceDocumentId", "parentBulletExactText", "parentBulletStartOffset", "parentBulletEndOffset", "exactText", "startOffset", "endOffset", "evidenceClass", "proofTypes", "metrics", "groundedEntities"], properties: { claimId: stringSchema, sourceDocumentId: stringSchema, positionId: stringSchema, title: stringSchema, employer: stringSchema, dates: stringSchema, parentBulletExactText: stringSchema, parentBulletStartOffset: numberSchema, parentBulletEndOffset: numberSchema, exactText: stringSchema, startOffset: numberSchema, endOffset: numberSchema, evidenceClass: { enum: ["WORK_HISTORY", "SELF_SUMMARY", "CAPABILITY_LABEL"] }, proofTypes: { type: "array", minItems: 1, items: { enum: proofTypes } }, metrics: { type: "array", items: metricSchema }, groundedEntities: { type: "array", items: entitySchema } } } as const;
const bulletSchema = { type: "object", additionalProperties: false, required: ["bulletId", "exactText", "startOffset", "endOffset", "claims"], properties: { bulletId: stringSchema, exactText: stringSchema, startOffset: numberSchema, endOffset: numberSchema, claims: { type: "array", items: claimSchema } } } as const;

export const LLM_OUTPUT_RUNTIME_SCHEMA = {
  role: { type: "object", additionalProperties: false, required: ["caseId", "canonicalJobId", "rawTextLength", "sections", "atoms", "metadata"], properties: { caseId: stringSchema, canonicalJobId: stringSchema, companyName: stringSchema, title: stringSchema, rawTextLength: numberSchema, sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "headingText", "headingStart", "headingEnd", "contentStart", "contentEnd", "rawContent"], properties: { type: { enum: sectionTypes }, headingText: stringSchema, headingStart: numberSchema, headingEnd: numberSchema, contentStart: numberSchema, contentEnd: numberSchema, rawContent: stringSchema, isSynthetic: { type: "boolean" } } } }, atoms: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "exactText", "startOffset", "endOffset", "section", "subject", "confidence", "extractionMethod", "epistemicMarker"], properties: { id: stringSchema, exactText: stringSchema, startOffset: numberSchema, endOffset: numberSchema, section: { enum: sectionTypes }, subject: { enum: roleSubjects }, semanticType: { enum: roleSemanticTypes }, confidence: numberSchema, extractionMethod: { enum: extractionMethods }, epistemicMarker: { const: "EXACT_SOURCE_STATEMENT" }, normalizedClaim: { type: "object" }, requirement: { type: "object" }, actionRole: { type: "object" } } } }, metadata: { type: "object", additionalProperties: false, required: ["extractorVersion", "hasGluedHeadings", "hasStructuralMetaLines", "proposalCounts"], properties: { extractorVersion: { const: "RoleIntelligenceExtractorV1" }, hasGluedHeadings: { type: "boolean" }, hasStructuralMetaLines: { type: "boolean" }, proposalCounts: { type: "object", additionalProperties: false, required: ["proposedAtoms", "acceptedAtoms", "rejectedAtoms"], properties: { proposedAtoms: numberSchema, acceptedAtoms: numberSchema, rejectedAtoms: numberSchema } } } } } },
  candidate: { type: "object", additionalProperties: false, required: ["sourceDocumentId", "rawDocumentLength", "positions", "selfSummaries", "capabilityLabels", "education", "allBullets", "allClaims", "metadata"], properties: { sourceDocumentId: stringSchema, rawDocumentLength: numberSchema, masthead: { type: "object", additionalProperties: false, required: ["rawText", "startOffset", "endOffset"], properties: { rawText: stringSchema, startOffset: numberSchema, endOffset: numberSchema } }, positions: { type: "array", items: { type: "object", additionalProperties: false, required: ["positionId", "title", "employer", "dates", "startOffset", "endOffset", "isCurrent", "bullets"], properties: { positionId: stringSchema, title: stringSchema, employer: stringSchema, dates: stringSchema, startOffset: numberSchema, endOffset: numberSchema, isCurrent: { type: "boolean" }, bullets: { type: "array", items: bulletSchema } } } }, selfSummaries: { type: "array", items: claimSchema }, capabilityLabels: { type: "array", items: claimSchema }, education: { type: "array", items: { type: "object", additionalProperties: false, required: ["degree", "institution", "rawText", "startOffset", "endOffset"], properties: { degree: stringSchema, institution: stringSchema, year: stringSchema, rawText: stringSchema, startOffset: numberSchema, endOffset: numberSchema } } }, allBullets: { type: "array", items: bulletSchema }, allClaims: { type: "array", items: claimSchema }, metadata: { type: "object", additionalProperties: false, required: ["extractorVersion", "totalProfessionalExperienceBullets", "bulletsRetained", "bulletsWithSpecializedClaims", "bulletsWithoutSpecializedClaims", "proposalCounts"], properties: { extractorVersion: { const: "CandidateProofExtractorV1" }, totalProfessionalExperienceBullets: numberSchema, bulletsRetained: numberSchema, bulletsWithSpecializedClaims: numberSchema, bulletsWithoutSpecializedClaims: numberSchema, proposalCounts: { type: "object", additionalProperties: false, required: ["proposedClaims", "acceptedClaims", "rejectedClaims"], properties: { proposedClaims: numberSchema, acceptedClaims: numberSchema, rejectedClaims: numberSchema } } } } } },
} as const;
