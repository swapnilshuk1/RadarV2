import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine, readOpportunities } from '../src/lib/intelligence/engine';
import { present } from '../src/lib/intelligence/present';
import { runEngine } from '@/lib/intelligence/engine';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '@/data/candidate-profile';
function getShortlist(active: number) { const builder = new CandidateProjectionBuilderImpl(); const proj = builder.fromProfile(candidateProfile); const { presented } = runEngine(proj as any, active); return presented.map(p => p.opportunity).filter(o => o.decision !== 'PASS'); }

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-golden-trace-for.js <jobHash> [jobHash...]');
  process.exit(1);
}

const builder = new CandidateProjectionBuilderImpl();
const proj = builder.fromProfile(candidateProfile);
const { records } = runEngine(proj as any, 0);
const ops = readOpportunities();
const shortlist = getShortlist(0);

for (const jobHash of args) {
  console.log('=== GOLDEN TRACE for', jobHash, '===');
  const record = records.find(r => r.jobHash === jobHash);
  if (!record) {
    console.log('No RecommendationRecord found for', jobHash);
  } else {
    console.log('RECORD:', JSON.stringify({ jobHash: record.jobHash, evaluationStatus: record.evaluationStatus, recommendation: record.verb, rawScore: record.rawScore, priority: record.priority, vetoed: record.vetoed, vetoReason: record.vetoReason, policySignature: record.policySignature || record.recommendationVersion, trace: record.trace }, null, 2));
    const source = ops.find(o => o.jobHash === jobHash);
    if (!source) console.log('No opportunity source found for', jobHash);
    else {
      console.log('SOURCE rawText snippet:', String((source as any).rawText || (source as any).description || '').slice(0,400));
      const pres = present(source, record, proj as any);
      console.log('PRESENTER (selected):', JSON.stringify({ decision: pres.opportunity.decision, recommendationResult: pres.opportunity.recommendationResult, policyVersion: pres.opportunity.recommendationResult?.policyVersion || null, dismissal: pres.opportunity.diligenceStatus }, null, 2));
    }
  }
  const shortlistItem = shortlist.find(s => s.jobHash === jobHash);
  console.log('SHORTLIST ITEM:', JSON.stringify(shortlistItem || null, null, 2));
  console.log('\n');
}
