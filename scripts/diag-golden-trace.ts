import fs from 'fs';
import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine, readOpportunities } from '../src/lib/intelligence/engine';
import { present } from '../src/lib/intelligence/present';
import { runEngine } from '@/lib/intelligence/engine';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '@/data/candidate-profile';
function getShortlist(active: number) { const builder = new CandidateProjectionBuilderImpl(); const proj = builder.fromProfile(candidateProfile); const { presented } = runEngine(proj as any, active); return presented.map(p => p.opportunity).filter(o => o.decision !== 'PASS'); }

// Replace these jobHashes with canonical ones in your corpus
const TARGET_JOB_HASHES = [
  'j-bmw-india-cmo', // BMW CMO — likely sparse in some fixtures
  // The other four you requested: choose representative job hashes present in your repo; if not present, they'll be skipped
  'j-reliance-cgo',
  'j-tcs-transformation',
  'j-vml-vp-perf',
  'j-acme-vp-mumbai'
];

function run() {
  const builder = new CandidateProjectionBuilderImpl();
  const proj = builder.fromProfile(candidateProfile);
  const { records } = runEngine(proj as any, 0);
  const ops = readOpportunities();
  const shortlist = getShortlist(0);

  for (const jobHash of TARGET_JOB_HASHES) {
    console.log('=== GOLDEN TRACE for', jobHash, '===');
    const record = records.find(r => r.jobHash === jobHash);
    if (!record) {
      console.log('No RecommendationRecord found for', jobHash);
    } else {
      console.log('RECORD:', JSON.stringify({ jobHash: record.jobHash, evaluationStatus: record.evaluationStatus, recommendation: record.verb, rawScore: record.rawScore, priority: record.priority, vetoed: record.vetoed, vetoReason: record.vetoReason, policySignature: record.policySignature || record.recommendationVersion, trace: record.trace }, null, 2));
      // find source opportunity
      const source = ops.find(o => o.jobHash === jobHash);
      if (!source) console.log('No opportunity source found for', jobHash);
      else {
        console.log('SOURCE rawTextHash:', source.jobHash, 'rawTextSnippet:', String((source as any).rawText || (source as any).description || '').slice(0,200));
        const pres = present(source, record, proj as any);
        console.log('PRESENTER output (selected fields):', JSON.stringify({ decision: pres.opportunity.decision, recommendationResult: pres.opportunity.recommendationResult, policyVersion: pres.opportunity.recommendationResult?.policyVersion || null, esi: pres.opportunity.esi, diligenceStatus: pres.opportunity.diligenceStatus }, null, 2));
      }
    }
    const shortlistItem = shortlist.find(s => s.jobHash === jobHash);
    console.log('SHORTLIST ITEM:', JSON.stringify(shortlistItem || null, null, 2));
    console.log('\n');
  }
}

run();
