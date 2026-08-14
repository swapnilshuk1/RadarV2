import fs from 'fs';
import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine } from '../src/lib/intelligence/engine';

function run() {
  const builder = new CandidateProjectionBuilderImpl();
  const proj = builder.fromProfile(candidateProfile);
  const { records } = runEngine(proj as any, 0);
  const missing: any[] = [];
  for (const r of records) {
    const candHash = r.trace?.candidateProjectionHash;
    const oppHash = r.trace?.opportunityContentHash;
    const policySig = r.policySignature || r.recommendationVersion || null;
    if (!candHash || !oppHash || !policySig) {
      missing.push({ jobHash: r.jobHash, candidateProjectionHash: candHash ?? null, opportunityContentHash: oppHash ?? null, policySignature: policySig });
    }
  }
  if (missing.length === 0) {
    console.log('All records contain candidateProjectionHash, opportunityContentHash and policySignature.');
  } else {
    console.log(`Found ${missing.length} records missing trace fields:`);
    for (const m of missing) console.log(JSON.stringify(m));
  }
}

run();
