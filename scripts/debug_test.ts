import { CandidateProjectionBuilder } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { JobProjectionBuilder } from '../src/lib/intelligence/builders/JobProjectionBuilder';
import { IdentityAssessmentEngine } from '../src/lib/intelligence/engines/IdentityAssessmentEngine';
import { CapabilityAssessmentEngine } from '../src/lib/intelligence/engines/CapabilityAssessmentEngine';
import { OpportunityAssessmentEngine } from '../src/lib/intelligence/engines/OpportunityAssessmentEngine';
import { CareerAssessmentEngine } from '../src/lib/intelligence/engines/CareerAssessmentEngine';
import { LifestyleAssessmentEngine } from '../src/lib/intelligence/engines/LifestyleAssessmentEngine';
import { DecisionPolicyEngine } from '../src/lib/intelligence/policy/DecisionPolicyEngine';
import { candidateProfile } from '../src/data/candidate-profile';

const candProj = CandidateProjectionBuilder.build(candidateProfile);

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

const smeJob = JobProjectionBuilder.build({
  jobHash: 'test-sme',
  role: 'Regional Sales & Marketing Representative',
  company: 'Belgaum Local Trading Co',
  location: 'Belgaum, Karnataka, India',
  description: 'Field sales executive for regional distributor network.'
});

function ev(j: any) {
  const identity = IdentityAssessmentEngine.evaluate(candProj, j);
  const capability = CapabilityAssessmentEngine.evaluate(candProj, j);
  const opportunity = OpportunityAssessmentEngine.evaluate(candProj, j);
  const career = CareerAssessmentEngine.evaluate(candProj, j);
  const lifestyle = LifestyleAssessmentEngine.evaluate(candProj, j);
  const policy = DecisionPolicyEngine.evaluate(identity, capability, opportunity, career, lifestyle);
  return {
    identityCoverage: identity.coverage,
    capabilityFit: capability.overallFit,
    careerScore: (career as any).careerScore,
    oppScore: (opportunity as any).opportunityScore,
    locPenalty: (lifestyle as any).locationFrictionPenalty,
    policy
  };
}

console.log('GOOGLE:', JSON.stringify(ev(googleJob), null, 2));
console.log('FORD:', JSON.stringify(ev(fordJob), null, 2));
console.log('SME:', JSON.stringify(ev(smeJob), null, 2));
