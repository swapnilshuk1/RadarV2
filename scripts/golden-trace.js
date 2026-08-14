// scripts/golden-trace.js
// Usage: node scripts/golden-trace.js j-bmw-india-cmo
import fs from 'fs';
import process from 'process';
import { CandidateProjectionBuilderImpl } from '@/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '@/data/candidate-profile';
import { runEngine, readOpportunities } from '@/lib/intelligence/engine';
import { present } from '@/lib/intelligence/present';
import { OpportunityProvider } from '@/lib/intelligence/opportunity-provider';

const jobHash = process.argv[2];
if (!jobHash) {
  console.error('Usage: node scripts/golden-trace.js <jobHash>');
  process.exit(1);
}

const builder = new CandidateProjectionBuilderImpl();
const projection = builder.fromProfile(candidateProfile);

const { records } = runEngine(projection, 0);
const record = records.find(r => r.jobHash === jobHash);
console.log('=== RecommendationRecord ===');
console.log(JSON.stringify(record, null, 2));

const ops = readOpportunities();
const source = ops.find(o => o.jobHash === jobHash);
if (!source) {
  console.warn('No opportunity source found for jobHash in readOpportunities()');
} else {
  const presented = present(source, record, projection);
  console.log('=== Presented (present()) ===');
  console.log(JSON.stringify(presented, null, 2));
}

const shortlist = OpportunityProvider.list({ activePursuits: 0 });
const listItem = shortlist.find(i => i.jobHash === jobHash);
console.log('=== Shortlist Item (if any) ===');
console.log(JSON.stringify(listItem || null, null, 2));