import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine, readOpportunities } from '../src/lib/intelligence/engine';
import { present } from '../src/lib/intelligence/present';
import { OpportunityProvider } from '../src/lib/intelligence/opportunity-provider';

const JOB_HASHES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'j-cdda239800fe',
  'j-f5873c10d6cd',
  'j-4d8a0ef3fad4',
  'j-fd09a5e8a65a',
  'j-9bc1610fec69'
];

(async function run() {
  try {
    const builder = new CandidateProjectionBuilderImpl();
    const proj = builder.fromProfile(candidateProfile);
    const { records } = runEngine(proj, 0);
    const ops = readOpportunities();
    const shortlist = OpportunityProvider.list({ activePursuits: 0 });

    for (const jobHash of JOB_HASHES) {
      console.log('=== GOLDEN TRACE for', jobHash, '===');
      const record = records.find((r: any) => r.jobHash === jobHash);
      if (!record) {
        console.log('No RecommendationRecord found for', jobHash);
      } else {
        console.log('RECORD:', JSON.stringify({ jobHash: record.jobHash, evaluationStatus: record.evaluationStatus, recommendation: record.verb, rawScore: record.rawScore, priority: record.priority, vetoed: record.vetoed, vetoReason: record.vetoReason, policySignature: record.policySignature || record.recommendationVersion, trace: record.trace }, null, 2));
      }

      const source = ops.find((o: any) => o.jobHash === jobHash);
      console.log('SOURCE rawText snippet:', source ? String(source.rawText || source.description || '').slice(0, 400) : 'NO SOURCE FOUND');

      if (record && source) {
        const pres = present(source, record, proj);
        console.log('PRESENTER (selected):', JSON.stringify({ decision: pres.opportunity.decision, recommendationResult: pres.opportunity.recommendationResult, policyVersion: pres.opportunity.recommendationResult?.policyVersion || null, diligenceStatus: pres.opportunity.diligenceStatus }, null, 2));
      }

      const shortlistItem = shortlist.find((s: any) => s.jobHash === jobHash);
      console.log('SHORTLIST ITEM:', JSON.stringify(shortlistItem || null, null, 2));
      console.log('\n');
    }
  } catch (err) {
    console.error('Golden trace script failed:', err);
    process.exit(1);
  }
})();
