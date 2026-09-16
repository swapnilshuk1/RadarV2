import { describe, expect, it } from 'vitest';
import {
  validateBoundedDecision,
  validateCandidateMapping,
  validateRoleAnalyticalCore,
} from '../../src/dossier/bounded-research-experiment';
import type { Claim, EvidenceSource } from '../../src/dossier/contracts';

const source: EvidenceSource = {
  id: 'jd',
  plane: 'JD',
  title: 'Role',
  locator: 'test',
  text: 'Candidates need a portfolio. Comfort operating strategically and hands-on. This is an individual contributor role.',
  capturedAt: '2026-01-01T00:00:00.000Z',
  attribution: 'JOB_POST',
};

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

describe('bounded research experiment contracts', () => {
  it('separates requirement importance, source strength, screening gate, and operating shape', () => {
    const roleClaims = [
      roleClaim('JD-1', 'Candidates need a strong portfolio.'),
      roleClaim('JD-2', 'Comfort operating at both strategic and execution levels.'),
      roleClaim('JD-3', 'This is an individual contributor role.'),
      roleClaim('JD-4', 'Healthcare experience is a strong plus, but not mandatory.'),
    ];

    expect(() => validateRoleAnalyticalCore({
      requirements: [
        {
          id: 'portfolio',
          requirement: 'Strong portfolio',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          screeningGate: true,
          roleClaimIds: ['JD-1'],
          reasoning: 'Explicit candidate doorway requirement.',
        },
        {
          id: 'strategic-execution',
          requirement: 'Comfort operating at both strategic and execution levels',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          screeningGate: false,
          roleClaimIds: ['JD-2'],
          reasoning: 'Material capability without explicit shortlisting language.',
        },
        {
          id: 'healthcare',
          requirement: 'Healthcare experience',
          strength: 'PREFERRED',
          roleImportance: 'ENABLER',
          screeningGate: false,
          roleClaimIds: ['JD-4'],
          reasoning: 'Explicitly preferred, not mandatory.',
        },
      ],
      operatingConditions: [{
        id: 'ic',
        condition: 'Craft-led IC',
        kind: 'OPERATING_SHAPE',
        roleClaimIds: ['JD-3'],
        reasoning: 'Role shape.',
      }],
      authorityShape: 'Craft-led',
      roleSideConditions: [],
    }, roleClaims, [source])).not.toThrow();

    expect(() => validateRoleAnalyticalCore({
      requirements: [{
        id: 'strategic-execution',
        requirement: 'Comfort operating at both strategic and execution levels',
        strength: 'REQUIRED',
        roleImportance: 'CORE_CAPABILITY',
        screeningGate: true,
        roleClaimIds: ['JD-2'],
        reasoning: 'Wrongly promoted to a gate.',
      }],
      operatingConditions: [],
      authorityShape: 'Craft-led',
      roleSideConditions: [],
    }, roleClaims, [source])).toThrow('explicit employer entry qualification');
  });

  it('does not allow a preferred requirement to become a screening gate', () => {
    const roleClaims = [roleClaim('JD-1', 'Healthcare experience is a strong plus, but not mandatory.')];

    expect(() => validateRoleAnalyticalCore({
      requirements: [{
        id: 'healthcare',
        requirement: 'Healthcare experience',
        strength: 'PREFERRED',
        roleImportance: 'ENABLER',
        screeningGate: true,
        roleClaimIds: ['JD-1'],
        reasoning: 'Wrong.',
      }],
      operatingConditions: [],
      authorityShape: 'Unspecified',
      roleSideConditions: [],
    }, roleClaims, [source])).toThrow('screening gate must be a required');
  });

  it('maps every immutable requirement exactly once, allows no authority facts, and requires evidence for contradiction', () => {
    const roleClaims = [roleClaim('JD-1', 'Candidates need a strong portfolio.')];
    const role = validateRoleAnalyticalCore({
      requirements: [{
        id: 'portfolio',
        requirement: 'Strong portfolio',
        strength: 'REQUIRED',
        roleImportance: 'CORE_CAPABILITY',
        screeningGate: true,
        roleClaimIds: ['JD-1'],
        reasoning: 'Explicit requirement.',
      }],
      operatingConditions: [],
      authorityShape: 'Unspecified',
      roleSideConditions: [],
    }, roleClaims, [source]);

    expect(() => validateCandidateMapping({
      mappings: [{
        requirementId: 'portfolio',
        status: 'NOT_EVIDENCED',
        candidateClaimIds: [],
        reasoning: 'No supplied portfolio.',
      }],
      authorityFacts: [],
    }, role, [candidateClaim('C-1')])).not.toThrow();

    expect(() => validateCandidateMapping({
      mappings: [{
        requirementId: 'portfolio',
        status: 'CONTRADICTED',
        candidateClaimIds: [],
        reasoning: 'Missing evidence is not a contradiction.',
      }],
      authorityFacts: [],
    }, role, [candidateClaim('C-1')])).toThrow('affirmative candidate evidence');
  });

  it('allows screening drivers only from explicit screening gates', () => {
    const roleClaims = [
      roleClaim('JD-1', 'Candidates need a strong portfolio.'),
      roleClaim('JD-2', 'Comfort operating at both strategic and execution levels.'),
      roleClaim('JD-3', 'This is an individual contributor role.'),
    ];
    const role = validateRoleAnalyticalCore({
      requirements: [
        {
          id: 'portfolio',
          requirement: 'Strong portfolio',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          screeningGate: true,
          roleClaimIds: ['JD-1'],
          reasoning: 'Gate.',
        },
        {
          id: 'strategic-execution',
          requirement: 'Strategic and execution range',
          strength: 'REQUIRED',
          roleImportance: 'CORE_CAPABILITY',
          screeningGate: false,
          roleClaimIds: ['JD-2'],
          reasoning: 'Capability, not gate.',
        },
      ],
      operatingConditions: [{
        id: 'ic',
        condition: 'Individual contributor role',
        kind: 'OPERATING_SHAPE',
        roleClaimIds: ['JD-3'],
        reasoning: 'Role shape.',
      }],
      authorityShape: 'Craft-led',
      roleSideConditions: [],
    }, roleClaims, [source]);

    const mapping = validateCandidateMapping({
      mappings: [
        {
          requirementId: 'portfolio',
          status: 'NOT_EVIDENCED',
          candidateClaimIds: [],
          reasoning: 'No portfolio supplied.',
        },
        {
          requirementId: 'strategic-execution',
          status: 'DIRECT',
          candidateClaimIds: ['C-1'],
          reasoning: 'Candidate evidence supports both levels.',
        },
      ],
      authorityFacts: [{ claimIds: ['C-2'], observation: 'Leads a 40-person team.' }],
    }, role, [
      candidateClaim('C-1', 'Led strategy and hands-on execution.'),
      candidateClaim('C-2'),
    ]);

    expect(() => validateBoundedDecision({
      screeningViability: 'BLOCKED',
      screeningRationale: 'Portfolio is the unresolved employer doorway.',
      screeningDriverRequirementIds: ['portfolio'],
      verdict: 'PASS',
      decisionRationale: 'Do not proceed unless the explicit gate can be cleared.',
      careerCapitalTrade: 'Current people authority would change in the IC role.',
      decisionHinges: [{ statement: 'Portfolio evidence would change accessibility.', claimIds: ['JD-1'] }],
    }, role, mapping, [], [
      candidateClaim('C-1', 'Led strategy and hands-on execution.'),
      candidateClaim('C-2'),
    ])).not.toThrow();

    expect(() => validateBoundedDecision({
      screeningViability: 'FRAGILE',
      screeningRationale: 'Wrongly uses a non-gate capability as screening.',
      screeningDriverRequirementIds: ['strategic-execution'],
      verdict: 'CONSIDER',
      decisionRationale: 'Wrong.',
      careerCapitalTrade: 'Authority trade.',
      decisionHinges: [{ statement: 'Role shape matters to pursuit.', claimIds: ['JD-3'] }],
    }, role, mapping, [], [
      candidateClaim('C-1', 'Led strategy and hands-on execution.'),
      candidateClaim('C-2'),
    ])).toThrow('is not an explicit screening gate');
  });

  it('permits decision hinges to cite role operating conditions without making them screening drivers', () => {
    const roleClaims = [
      roleClaim('JD-1', 'Candidates need a strong portfolio.'),
      roleClaim('JD-2', 'This is an individual contributor role.'),
    ];
    const role = validateRoleAnalyticalCore({
      requirements: [{
        id: 'portfolio',
        requirement: 'Strong portfolio',
        strength: 'REQUIRED',
        roleImportance: 'CORE_CAPABILITY',
        screeningGate: true,
        roleClaimIds: ['JD-1'],
        reasoning: 'Gate.',
      }],
      operatingConditions: [{
        id: 'ic',
        condition: 'Individual contributor role',
        kind: 'OPERATING_SHAPE',
        roleClaimIds: ['JD-2'],
        reasoning: 'Role shape.',
      }],
      authorityShape: 'Craft-led',
      roleSideConditions: [],
    }, roleClaims, [source]);

    const mapping = validateCandidateMapping({
      mappings: [{
        requirementId: 'portfolio',
        status: 'DIRECT',
        candidateClaimIds: ['C-1'],
        reasoning: 'Portfolio supplied.',
      }],
      authorityFacts: [{ claimIds: ['C-2'], observation: 'Current people leadership.' }],
    }, role, [
      candidateClaim('C-1', 'Portfolio supplied.'),
      candidateClaim('C-2'),
    ]);

    expect(() => validateBoundedDecision({
      screeningViability: 'STRONG',
      screeningRationale: 'The explicit gate is evidenced.',
      screeningDriverRequirementIds: ['portfolio'],
      verdict: 'CONSIDER',
      decisionRationale: 'Accessibility is strong; authority trade still matters.',
      careerCapitalTrade: 'Moving from people leadership to craft-led IC changes authority shape.',
      decisionHinges: [{
        statement: 'The IC authority model is a pursuit question, not an employer screen.',
        claimIds: ['JD-2', 'C-2'],
      }],
    }, role, mapping, [], [
      candidateClaim('C-1', 'Portfolio supplied.'),
      candidateClaim('C-2'),
    ])).not.toThrow();
  });
});
