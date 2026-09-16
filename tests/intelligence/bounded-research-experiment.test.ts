import { describe, expect, it } from 'vitest';
import {
  applyScreeningAdjudication,
  validateBoundedDecision,
  validateCandidateMapping,
  validateRoleAnalyticalCore,
  validateScreeningAdjudication,
} from '../../src/dossier/bounded-research-experiment';
import type { Claim } from '../../src/dossier/contracts';

const roleClaim = (id: string, text: string, quote = text): Claim => ({
  id,
  text,
  state: 'EXPLICIT',
  confidence: 1,
  plane: 'JD',
  citations: [{ sourceId: 'jd', quote }],
  derivedFrom: [],
});

const candidateClaim = (id: string, text = 'Led a 40-person team.'): Claim => ({
  id,
  text,
  state: 'EXPLICIT',
  confidence: 1,
  plane: 'CANDIDATE',
  citations: [{ sourceId: 'cv', quote: text }],
  derivedFrom: [],
});

function buildRole() {
  const roleClaims = [
    roleClaim('JD-1', 'Candidates need a strong portfolio.'),
    roleClaim('JD-2', 'Comfort operating at both strategic and execution levels.'),
    roleClaim('JD-3', 'This is an individual contributor role.'),
    roleClaim('JD-4', 'Healthcare experience is a strong plus, but not mandatory.'),
  ];

  const role = validateRoleAnalyticalCore({
    requirements: [
      {
        id: 'portfolio',
        requirement: 'Strong portfolio',
        strength: 'REQUIRED',
        roleImportance: 'CORE_CAPABILITY',
        roleClaimIds: ['JD-1'],
        reasoning: 'Candidate capability/artifact requirement.',
      },
      {
        id: 'strategic-execution',
        requirement: 'Comfort operating at both strategic and execution levels',
        strength: 'REQUIRED',
        roleImportance: 'CORE_CAPABILITY',
        roleClaimIds: ['JD-2'],
        reasoning: 'Material capability.',
      },
      {
        id: 'healthcare',
        requirement: 'Healthcare experience',
        strength: 'PREFERRED',
        roleImportance: 'ENABLER',
        roleClaimIds: ['JD-4'],
        reasoning: 'Preferred domain context.',
      },
    ],
    operatingConditions: [{
      id: 'ic',
      condition: 'Craft-led individual contributor role',
      kind: 'AUTHORITY_SHAPE',
      roleClaimIds: ['JD-3'],
      reasoning: 'Role authority shape.',
    }],
    authorityShape: 'Craft-led individual contributor',
    roleSideConditions: [],
  }, roleClaims);

  const screening = validateScreeningAdjudication({
    decisions: [
      { requirementId: 'portfolio', screeningGate: true, reasoning: 'Explicit qualifying artifact.' },
      { requirementId: 'strategic-execution', screeningGate: false, reasoning: 'Capability, not doorway.' },
      { requirementId: 'healthcare', screeningGate: false, reasoning: 'Preferred only.' },
    ],
  }, role);

  return { roleClaims, role: applyScreeningAdjudication(role, screening) };
}

describe('bounded research experiment contracts', () => {
  it('keeps screening adjudication out of role interpretation and allows shared JD ancestry', () => {
    const roleClaims = [
      roleClaim('JD-1', 'Ability to build accountability and maintain team discipline.'),
      roleClaim('JD-2', 'Relevant Operations or Project Management experience is required.'),
    ];

    expect(() => validateRoleAnalyticalCore({
      requirements: [
        {
          id: 'discipline',
          requirement: 'Ability to build accountability and maintain team discipline',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          roleClaimIds: ['JD-1'],
          reasoning: 'Candidate capability.',
        },
        {
          id: 'experience',
          requirement: 'Relevant Operations or Project Management experience',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          roleClaimIds: ['JD-2'],
          reasoning: 'Candidate experience requirement.',
        },
      ],
      operatingConditions: [{
        id: 'people-manager',
        condition: 'People manager accountable for team discipline',
        kind: 'AUTHORITY_SHAPE',
        roleClaimIds: ['JD-1'],
        reasoning: 'The same source fact also informs role authority shape.',
      }],
      authorityShape: 'People manager',
      roleSideConditions: [],
    }, roleClaims)).not.toThrow();
  });

  it('freezes screening separately and never allows a preferred requirement to become a gate', () => {
    const roleClaims = [
      roleClaim('JD-1', '10+ years of relevant experience.'),
      roleClaim('JD-2', 'Healthcare experience is a strong plus, but not mandatory.'),
    ];
    const role = validateRoleAnalyticalCore({
      requirements: [
        {
          id: 'experience',
          requirement: '10+ years of relevant experience',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          roleClaimIds: ['JD-1'],
          reasoning: 'Required threshold.',
        },
        {
          id: 'healthcare',
          requirement: 'Healthcare experience',
          strength: 'PREFERRED',
          roleImportance: 'ENABLER',
          roleClaimIds: ['JD-2'],
          reasoning: 'Preferred context.',
        },
      ],
      operatingConditions: [],
      authorityShape: 'Unspecified',
      roleSideConditions: [],
    }, roleClaims);

    const accepted = validateScreeningAdjudication({
      decisions: [
        { requirementId: 'experience', screeningGate: true, reasoning: 'Entry threshold.' },
        { requirementId: 'healthcare', screeningGate: false, reasoning: 'Preferred only.' },
      ],
    }, role);
    expect(applyScreeningAdjudication(role, accepted).requirements[0].screeningGate).toBe(true);

    expect(() => validateScreeningAdjudication({
      decisions: [
        { requirementId: 'experience', screeningGate: true, reasoning: 'Entry threshold.' },
        { requirementId: 'healthcare', screeningGate: true, reasoning: 'Wrong.' },
      ],
    }, role)).toThrow('preferred requirement cannot become a screening gate');
  });

  it('requires screening adjudication to decide every immutable requirement exactly once', () => {
    const { roleClaims } = buildRole();
    const role = validateRoleAnalyticalCore({
      requirements: [
        {
          id: 'a',
          requirement: 'A',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          roleClaimIds: ['JD-1'],
          reasoning: 'A.',
        },
        {
          id: 'b',
          requirement: 'B',
          strength: 'REQUIRED',
          roleImportance: 'ENABLER',
          roleClaimIds: ['JD-2'],
          reasoning: 'B.',
        },
      ],
      operatingConditions: [],
      authorityShape: 'Unspecified',
      roleSideConditions: [],
    }, roleClaims);

    expect(() => validateScreeningAdjudication({
      decisions: [{ requirementId: 'a', screeningGate: true, reasoning: 'A gate.' }],
    }, role)).toThrow('omitted an immutable role requirement');
  });

  it('prevents DIRECT when the model itself identifies unsupported requirement aspects', () => {
    const { role } = buildRole();
    const candidates = [candidateClaim('C-1', 'Twenty years of brand leadership.')];

    expect(() => validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: ['No UX/product-design portfolio evidence'],
          reasoning: 'Brand is strong but UX is missing.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'ADJACENT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: ['Hands-on product execution not established'],
          reasoning: 'Adjacent.',
        },
        {
          requirementId: 'healthcare',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No healthcare product experience'],
          reasoning: 'Not evidenced.',
        },
      ],
      authorityFacts: [],
    }, role, candidates)).toThrow('Direct fit mapping cannot contain unsupported requirement aspects');
  });

  it('allows adjacent mappings with unsupported aspects and requires affirmative evidence for contradiction', () => {
    const { role } = buildRole();
    const candidates = [
      candidateClaim('C-1', 'Brand strategy leadership.'),
      candidateClaim('C-2', 'Explicitly lacks the required licence.'),
    ];

    expect(() => validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'ADJACENT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: ['UX rigor not established'],
          reasoning: 'Brand evidence only.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: [],
          reasoning: 'Fully evidenced for fixture purposes.',
        },
        {
          requirementId: 'healthcare',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No healthcare evidence'],
          reasoning: 'Absent.',
        },
      ],
      authorityFacts: [],
    }, role, candidates)).not.toThrow();

    expect(() => validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'CONTRADICTED',
          candidateClaimIds: [],
          unsupportedAspects: ['No portfolio'],
          reasoning: 'Missing evidence is not contradiction.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: [],
          reasoning: 'Direct.',
        },
        {
          requirementId: 'healthcare',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No healthcare evidence'],
          reasoning: 'Absent.',
        },
      ],
      authorityFacts: [],
    }, role, candidates)).toThrow('affirmative candidate evidence');
  });

  it('uses typed decision references and permits operating conditions in career reasoning without making them screening drivers', () => {
    const { role } = buildRole();
    const candidates = [
      candidateClaim('C-1', 'Portfolio supplied.'),
      candidateClaim('C-2', 'Leads a 40-person team.'),
    ];
    const mapping = validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: [],
          reasoning: 'Portfolio supplied.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: [],
          reasoning: 'Direct for fixture purposes.',
        },
        {
          requirementId: 'healthcare',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No healthcare experience'],
          reasoning: 'Preferred only.',
        },
      ],
      authorityFacts: [{ claimIds: ['C-2'], observation: 'Current people leadership.' }],
    }, role, candidates);

    expect(() => validateBoundedDecision({
      screeningViability: 'STRONG',
      screeningRationale: 'The explicit gate is evidenced.',
      screeningDriverRequirementIds: ['portfolio'],
      verdict: 'CONSIDER',
      decisionRationale: 'Accessible, but authority trade matters.',
      careerCapitalTrade: 'Moving from people leadership to craft-led IC changes authority shape.',
      decisionHinges: [{
        statement: 'The portfolio gate is met while the IC authority model remains a candidate-side trade.',
        refs: [
          { kind: 'ROLE_REQUIREMENT', id: 'portfolio' },
          { kind: 'OPERATING_CONDITION', id: 'ic' },
          { kind: 'CANDIDATE_CLAIM', id: 'C-2' },
        ],
      }],
    }, role, mapping, [], candidates)).not.toThrow();
  });

  it('requires PASS when screening viability is BLOCKED', () => {
    const { role } = buildRole();
    const candidates = [candidateClaim('C-1', 'Strategic execution experience.')];
    const mapping = validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No portfolio supplied'],
          reasoning: 'Gate unresolved.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          unsupportedAspects: [],
          reasoning: 'Direct.',
        },
        {
          requirementId: 'healthcare',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          unsupportedAspects: ['No healthcare evidence'],
          reasoning: 'Preferred only.',
        },
      ],
      authorityFacts: [],
    }, role, candidates);

    expect(() => validateBoundedDecision({
      screeningViability: 'BLOCKED',
      screeningRationale: 'Portfolio gate is not evidenced.',
      screeningDriverRequirementIds: ['portfolio'],
      verdict: 'PURSUE',
      decisionRationale: 'Wrongly relies on a hypothetical waiver.',
      careerCapitalTrade: 'Neutral.',
      decisionHinges: [{
        statement: 'Employer could theoretically waive the gate.',
        refs: [{ kind: 'ROLE_REQUIREMENT', id: 'portfolio' }],
      }],
    }, role, mapping, [], candidates)).toThrow('Blocked screening viability requires a PASS verdict');

    expect(() => validateBoundedDecision({
      screeningViability: 'BLOCKED',
      screeningRationale: 'Portfolio gate is not evidenced.',
      screeningDriverRequirementIds: ['portfolio'],
      verdict: 'PASS',
      decisionRationale: 'Current doorway is blocked.',
      careerCapitalTrade: 'Neutral.',
      decisionHinges: [{
        statement: 'Supplying the missing portfolio would reopen accessibility.',
        refs: [
          { kind: 'ROLE_REQUIREMENT', id: 'portfolio' },
          { kind: 'ROLE_CLAIM', id: 'JD-1' },
        ],
      }],
    }, role, mapping, [], candidates)).not.toThrow();
  });
});
