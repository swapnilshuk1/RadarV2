import fs from 'fs';
import path from 'path';
import { candidateProfile } from '../src/data/candidate-profile';
import { CandidateProjectionBuilder } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { JobProjectionBuilder } from '../src/lib/intelligence/builders/JobProjectionBuilder';
import { IdentityAssessmentEngine } from '../src/lib/intelligence/engines/IdentityAssessmentEngine';
import { CapabilityAssessmentEngine } from '../src/lib/intelligence/engines/CapabilityAssessmentEngine';
import { OpportunityAssessmentEngine } from '../src/lib/intelligence/engines/OpportunityAssessmentEngine';
import { CareerAssessmentEngine } from '../src/lib/intelligence/engines/CareerAssessmentEngine';
import { LifestyleAssessmentEngine } from '../src/lib/intelligence/engines/LifestyleAssessmentEngine';
import { DecisionPolicyEngine } from '../src/lib/intelligence/policy/DecisionPolicyEngine';

const candProj = CandidateProjectionBuilder.build(candidateProfile);

// Build Synthetic Test Scenarios for Positive, Weak, Sparse, and Behavioral Benchmarks
const googleJob = JobProjectionBuilder.build({
  jobHash: 'test-google',
  role: 'Senior Marketing Manager Lead, Growth',
  company: 'Google',
  location: 'Gurugram, Haryana, India (On-site)',
  description: 'Lead Google Ads growth marketing, performance marketing, CRM transformation, and brand marketing CoE.'
});

const fordJob = JobProjectionBuilder.build({
  jobHash: 'test-ford',
  role: 'Marketing Director',
  company: 'Ford',
  location: 'Gurugram, Haryana, India (On-site)',
  description: 'Manage brand marketing, growth strategy, and commercial transformation for automotive marketing.'
});

const regionalSmeJob = JobProjectionBuilder.build({
  jobHash: 'test-sme',
  role: 'Regional Sales & Marketing Representative',
  company: 'Belgaum Local Trading Co',
  location: 'Belgaum, Karnataka, India',
  description: 'Field sales executive for regional distributor network.'
});

const sparseJob = JobProjectionBuilder.build({
  jobHash: 'test-sparse',
  role: 'Marketing',
  company: 'Unknown',
  location: 'Unknown',
  description: 'Hiring manager looking for marketer.'
});

// Evaluate all scenarios
function evalJob(jobProj: any) {
  const identity = IdentityAssessmentEngine.evaluate(candProj, jobProj);
  const capability = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
  const opportunity = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
  const career = CareerAssessmentEngine.evaluate(candProj, jobProj);
  const lifestyle = LifestyleAssessmentEngine.evaluate(candProj, jobProj);

  const policy = DecisionPolicyEngine.evaluate(identity, capability, opportunity, career, lifestyle);
  return { identity, capability, opportunity, career, lifestyle, policy };
}

const resGoogle = evalJob(googleJob);
const resFord = evalJob(fordJob);
const resSme = evalJob(regionalSmeJob);
const resSparse = evalJob(sparseJob);

console.log('============================================================');
console.log('           RADAR BEHAVIORAL ACCEPTANCE SUITE               ');
console.log('============================================================');

let assertionsPassed = 0;
let totalAssertions = 0;

function assertBehavior(description: string, condition: boolean) {
  totalAssertions++;
  if (condition) {
    assertionsPassed++;
    console.log(` ✓ [PASS] ${description}`);
  } else {
    console.error(` ✗ [FAIL] ${description}`);
  }
}

// Behavioral Assertions (Point 10)
assertBehavior(
  'Tier-1 Google Role ranks above Tier-2 Ford Role in priority score',
  resGoogle.policy.priorityScore > resFord.policy.priorityScore
);

assertBehavior(
  'Ford Role ranks above Regional SME Role in priority score',
  resFord.policy.priorityScore > resSme.policy.priorityScore
);

assertBehavior(
  'Regional Belgaum location receives higher friction penalty than Metro location',
  resSme.lifestyle.locationFrictionPenalty > resGoogle.lifestyle.locationFrictionPenalty
);

assertBehavior(
  'Sparse single-keyword JD is downgraded to PASS or low score due to evidence gate',
  resSparse.policy.verdict === 'PASS' || resSparse.policy.priorityScore < 60
);

assertBehavior(
  'Strong Google Role achieves PURSUE or high CONSIDER verdict',
  resGoogle.policy.priorityScore >= 70
);

console.log('------------------------------------------------------------');
console.log(`Summary: ${assertionsPassed} / ${totalAssertions} Behavioral Assertions Passed`);
console.log('============================================================\n');

// Load original audit trace for persistent logging
const inputData = JSON.parse(fs.readFileSync('./scratch/pursue_details.json', 'utf-8'));
const auditTrace: any[] = [];

for (const item of inputData.pursueJobs) {
  const rec = item.record;
  const raw = item.rawOpportunity || {};
  const jobProj = raw ? JobProjectionBuilder.build(raw) : null;
  if (!jobProj) continue;

  const evalRes = evalJob(jobProj);

  auditTrace.push({
    role: rec.role,
    company: rec.company,
    id: rec.id,
    jobProjection: jobProj,
    engineOutputs: {
      identity: evalRes.identity,
      capability: evalRes.capability,
      opportunity: evalRes.opportunity,
      career: evalRes.career,
      lifestyle: evalRes.lifestyle
    },
    policyOutput: evalRes.policy,
    finalRecord: rec
  });
}

const outFile = path.resolve(process.cwd(), 'scratch/forensic_trace.json');
fs.writeFileSync(outFile, JSON.stringify({ candProj, auditTrace }, null, 2));
console.log('Forensic trace successfully written to:', outFile);
