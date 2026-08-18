// scripts/mutation-causality.js
// Usage: node scripts/mutation-causality.js <jobHash>
import fs from 'fs';
import process from 'process';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '@/data/candidate-profile';
import { runEngine, computeEvaluationSignature, invalidateEngineCache } from '@/lib/intelligence/engine';
import decisionPolicy from '@/data/ontology/decision_policy.json';

const jobHash = process.argv[2];
if (!jobHash) { console.error('Usage: node scripts/mutation-causality.js <jobHash>'); process.exit(1); }

const builder = new CandidateProjectionBuilderImpl();
const projA = builder.fromProfile(candidateProfile);
const projB = JSON.parse(JSON.stringify(projA));
projB.executiveThemes = (projB.executiveThemes || []).concat(['MUTATION_TEST']);

function runAndFind(proj, label) {
  const { records } = runEngine(proj, 0);
  const r = records.find(x => x.jobHash === jobHash);
  console.log(`--- ${label} ---`);
  if (!r) { console.log('No record for jobHash in this run'); return null; }
  console.log('recommendationVersion:', r.recommendationVersion);
  console.log('priority:', r.priority);
  console.log('evaluationStatus:', r.evaluationStatus);
  console.log('policySignature:', r.policySignature || r.recommendationVersion);
  console.log('trace.candidateProjectionHash:', r.trace?.candidateProjectionHash);
  console.log('trace.opportunityContentHash:', r.trace?.opportunityContentHash);
  return r;
}

console.log('Policy signature (computed from JSON):', require('crypto').createHash('sha256').update(JSON.stringify(decisionPolicy)).digest('hex'));

invalidateEngineCache();
const rA = runAndFind(projA, 'RUN A (candidate A)');

invalidateEngineCache();
const rB = runAndFind(projB, 'RUN B (candidate B)');

invalidateEngineCache();
const rB2 = runAndFind(projB, 'RUN B2 after restart (candidate B)');

// Compare
console.log('--- Comparison ---');
if (rA && rB) {
  console.log('recommendationVersion equal?', rA.recommendationVersion === rB.recommendationVersion);
  console.log('candidateProjectionHash equal?', (rA.trace?.candidateProjectionHash) === (rB.trace?.candidateProjectionHash));
}