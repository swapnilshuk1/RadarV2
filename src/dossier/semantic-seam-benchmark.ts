import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Claim } from './contracts';

export const seamFitStatusSchema = z.enum([
  'DIRECT',
  'ADJACENT',
  'TRANSFERABLE',
  'NOT_EVIDENCED',
  'CONTRADICTED',
]);
export type SeamFitStatus = z.infer<typeof seamFitStatusSchema>;

export const screeningSeamResponseSchema = z.object({
  screeningGate: z.boolean(),
  reasoning: z.string().min(1),
});
export type ScreeningSeamResponse = z.infer<typeof screeningSeamResponseSchema>;

export const mappingSeamResponseSchema = z.object({
  status: seamFitStatusSchema,
  candidateClaimIds: z.array(z.string()),
  unsupportedAspects: z.array(z.string()),
  reasoning: z.string().min(1),
});
export type MappingSeamResponse = z.infer<typeof mappingSeamResponseSchema>;

export type SeamCaseKey = 'schnell' | 'artificilux' | '2070';

export type FrozenRoleRequirement = {
  id: string;
  requirement: string;
  strength: 'REQUIRED' | 'PREFERRED';
  roleImportance: 'CORE_CAPABILITY' | 'ENABLER';
  roleClaimIds: string[];
};

export type ScreeningFixture = {
  id: string;
  caseKey: SeamCaseKey;
  requirement: FrozenRoleRequirement;
  expectedGate: boolean;
  semanticNote: string;
};

export type MappingFixture = {
  id: string;
  caseKey: SeamCaseKey;
  requirement: FrozenRoleRequirement;
  allowedStatuses: SeamFitStatus[];
  requireUnsupportedAspects: boolean;
  semanticNote: string;
};

const req = (
  id: string,
  requirement: string,
  strength: FrozenRoleRequirement['strength'],
  roleImportance: FrozenRoleRequirement['roleImportance'],
  ...roleClaimIds: string[]
): FrozenRoleRequirement => ({ id, requirement, strength, roleImportance, roleClaimIds });

// These fixtures intentionally freeze only the disputed v3 semantic seams. They
// are benchmark cases, not production rules and not a replacement role ontology.
export const screeningFixtures: ScreeningFixture[] = [
  {
    id: 'schnell-real-estate-10y',
    caseKey: 'schnell',
    requirement: req('REQ-1', 'Minimum 10 years full-time real estate/property sales experience', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-59'),
    expectedGate: true,
    semanticNote: 'Explicit minimum real-estate sales experience requirement.',
  },
  {
    id: 'schnell-high-ticket-close',
    caseKey: 'schnell',
    requirement: req('REQ-4', 'Verifiable track record of personally closing high-ticket transactions (units of ₹3 Cr+, or bulk/commercial deals of ₹10 Cr+) with substantial cumulative booking value', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-62'),
    expectedGate: true,
    semanticNote: 'Explicit must-have prior transaction-closing qualification.',
  },
  {
    id: 'schnell-build-sales-team',
    caseKey: 'schnell',
    requirement: req('REQ-6', 'Experience building a sales team from a standing start — not only inheriting one', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-64'),
    expectedGate: true,
    semanticNote: 'Explicit must-have prior experience qualification without a numeric threshold.',
  },
  {
    id: 'schnell-exclusive-mandates',
    caseKey: 'schnell',
    requirement: req('REQ-8', 'Experience originating, negotiating or delivering exclusive sales mandates for third-party developers or asset owners', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-66'),
    expectedGate: true,
    semanticNote: 'Explicit must-have prior mandate qualification without a numeric threshold.',
  },
  {
    id: 'schnell-hindi-preference',
    caseKey: 'schnell',
    requirement: req('REQ-16', 'Fluency in English and Hindi', 'PREFERRED', 'ENABLER', 'JD-1-73'),
    expectedGate: false,
    semanticNote: 'Explicitly preferred/not-disqualifying item.',
  },
  {
    id: 'artificilux-relevant-experience',
    caseKey: 'artificilux',
    requirement: req('REQ-1', 'Relevant experience in Operations / Project Management / Team Management', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-3'),
    expectedGate: true,
    semanticNote: 'Explicit employer-side experience qualification; no numeric duration is required for gate status.',
  },
  {
    id: 'artificilux-problem-solving',
    caseKey: 'artificilux',
    requirement: req('REQ-5', 'Strong problem-solving ability', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-44'),
    expectedGate: false,
    semanticNote: 'Required job-performance capability, not an explicit pre-entry qualification.',
  },
  {
    id: '2070-dual-domain-10y',
    caseKey: '2070',
    requirement: req('REQ-001', '10+ years of experience spanning brand and UX/product design', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-17'),
    expectedGate: true,
    semanticNote: 'Explicit quantified experience qualification.',
  },
  {
    id: '2070-portfolio',
    caseKey: '2070',
    requirement: req('REQ-003', 'Strong portfolio demonstrating brand craft (identity, storytelling, visual systems) and UX rigor (research-informed, outcome-driven design)', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-19'),
    expectedGate: true,
    semanticNote: 'Required qualifying artifact.',
  },
  {
    id: '2070-strategic-execution',
    caseKey: '2070',
    requirement: req('REQ-004', 'Comfort operating at both strategic and execution levels', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-20'),
    expectedGate: false,
    semanticNote: 'Required capability/operating range, not a distinct employer-entry qualification.',
  },
  {
    id: '2070-senior-ic-preference',
    caseKey: '2070',
    requirement: req('REQ-002', 'Senior individual-contributor experience at a consumer tech, D2C, or digital health company', 'PREFERRED', 'ENABLER', 'JD-1-18'),
    expectedGate: false,
    semanticNote: 'Explicitly ideal/preferred background.',
  },
  {
    id: '2070-healthcare-preference',
    caseKey: '2070',
    requirement: req('REQ-006', 'Experience in healthcare, wellness, or behavior-change products', 'PREFERRED', 'ENABLER', 'JD-1-22'),
    expectedGate: false,
    semanticNote: 'Explicit strong-plus/not-mandatory background.',
  },
];

export const mappingFixtures: MappingFixture[] = [
  {
    id: 'schnell-high-ticket-close',
    caseKey: 'schnell',
    requirement: req('REQ-4', 'Verifiable track record of personally closing high-ticket transactions (units of ₹3 Cr+, or bulk/commercial deals of ₹10 Cr+) with substantial cumulative booking value', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-62'),
    allowedStatuses: ['NOT_EVIDENCED'],
    requireUnsupportedAspects: true,
    semanticNote: 'Marketing portfolio value, fee books, attributed revenue, or budgets do not evidence personally closed real-estate transactions.',
  },
  {
    id: 'schnell-exclusive-mandates',
    caseKey: 'schnell',
    requirement: req('REQ-8', 'Experience originating, negotiating or delivering exclusive sales mandates for third-party developers or asset owners', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-66'),
    allowedStatuses: ['ADJACENT', 'TRANSFERABLE', 'NOT_EVIDENCED'],
    requireUnsupportedAspects: true,
    semanticNote: 'Agency/client marketing mandate wins cannot be represented as direct property-sales mandate experience.',
  },
  {
    id: 'schnell-hindi-fluency',
    caseKey: 'schnell',
    requirement: req('REQ-16', 'Fluency in English and Hindi', 'PREFERRED', 'ENABLER', 'JD-1-73'),
    allowedStatuses: ['NOT_EVIDENCED'],
    requireUnsupportedAspects: true,
    semanticNote: 'India-market senior roles are not direct evidence of Hindi fluency.',
  },
  {
    id: 'artificilux-relevant-experience',
    caseKey: 'artificilux',
    requirement: req('REQ-1', 'Relevant experience in Operations / Project Management / Team Management', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-3'),
    allowedStatuses: ['DIRECT', 'ADJACENT'],
    requireUnsupportedAspects: false,
    semanticNote: 'Candidate has substantial team-management precedent and adjacent operations/project-delivery precedent; missing evidence must not become contradiction.',
  },
  {
    id: '2070-dual-domain-10y',
    caseKey: '2070',
    requirement: req('REQ-001', '10+ years of experience spanning brand and UX/product design', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-17'),
    allowedStatuses: ['ADJACENT', 'NOT_EVIDENCED'],
    requireUnsupportedAspects: true,
    semanticNote: 'Long brand/marketing tenure does not directly satisfy the combined brand + UX/product-design discipline requirement.',
  },
  {
    id: '2070-portfolio',
    caseKey: '2070',
    requirement: req('REQ-003', 'Strong portfolio demonstrating brand craft (identity, storytelling, visual systems) and UX rigor (research-informed, outcome-driven design)', 'REQUIRED', 'CORE_CAPABILITY', 'JD-1-19'),
    allowedStatuses: ['ADJACENT', 'NOT_EVIDENCED'],
    requireUnsupportedAspects: true,
    semanticNote: 'Brand campaign evidence is not a substitute for a portfolio demonstrating UX rigor.',
  },
];

export function seamFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function exactClaimIds(ids: readonly string[], claims: Claim[]) {
  const known = new Set(claims.map(claim => claim.id));
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate candidate mapping claim reference');
  if (ids.some(id => !known.has(id))) throw new Error('Unknown candidate mapping claim reference');
}

export function validateScreeningSeamResponse(value: unknown): ScreeningSeamResponse {
  return screeningSeamResponseSchema.parse(value);
}

export function validateMappingSeamResponse(
  value: unknown,
  candidateClaims: Claim[],
): MappingSeamResponse {
  const response = mappingSeamResponseSchema.parse(value);
  exactClaimIds(response.candidateClaimIds, candidateClaims);

  if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(response.status) && !response.candidateClaimIds.length) {
    throw new Error('Positive fit mapping needs candidate proof');
  }
  if (response.status === 'CONTRADICTED' && !response.candidateClaimIds.length) {
    throw new Error('Contradicted fit mapping needs affirmative candidate evidence');
  }
  if (response.status === 'DIRECT' && response.unsupportedAspects.length) {
    throw new Error('Direct fit mapping cannot contain unsupported requirement aspects');
  }
  return response;
}

export function scoreScreeningFixture(
  fixture: ScreeningFixture,
  response: ScreeningSeamResponse,
) {
  return {
    passed: response.screeningGate === fixture.expectedGate,
    expectedGate: fixture.expectedGate,
    actualGate: response.screeningGate,
  };
}

export function scoreMappingFixture(
  fixture: MappingFixture,
  response: MappingSeamResponse,
) {
  const failures: string[] = [];
  if (!fixture.allowedStatuses.includes(response.status)) {
    failures.push(`status ${response.status} not in allowed set ${fixture.allowedStatuses.join(', ')}`);
  }
  if (fixture.requireUnsupportedAspects && response.unsupportedAspects.length === 0) {
    failures.push('material unsupported aspects were omitted');
  }
  return { passed: failures.length === 0, failures };
}
