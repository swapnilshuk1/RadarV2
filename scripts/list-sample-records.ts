import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine } from '../src/lib/intelligence/engine';

function run() {
  const builder = new CandidateProjectionBuilderImpl();
  const proj = builder.fromProfile(candidateProfile);
  const { records } = runEngine(proj as any, 0);
  const byStatus: Record<string, any[]> = {};
  for (const r of records) {
    const k = `${r.evaluationStatus || 'UNKNOWN'}|${r.verb || 'NONE'}`;
    if (!byStatus[k]) byStatus[k] = [];
    byStatus[k].push(r);
  }
  const keys = Object.keys(byStatus).sort((a,b)=> byStatus[b].length - byStatus[a].length);
  console.log('Total records:', records.length);
  for (const k of keys) {
    console.log('\n===', k, 'count=', byStatus[k].length, '===');
    const sample = byStatus[k].slice(0,5);
    for (const r of sample) {
      console.log(JSON.stringify({ jobHash: r.jobHash, evaluationStatus: r.evaluationStatus, verb: r.verb, priority: r.priority, rawScore: r.rawScore, vetoed: r.vetoed, vetoReason: r.vetoReason, policySignature: r.policySignature || r.recommendationVersion, candidateProjectionHash: r.trace?.candidateProjectionHash || null, opportunityContentHash: r.trace?.opportunityContentHash || null }, null, 2));
    }
  }
}

run();
