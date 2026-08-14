// Verification script for the three defect fixes

import { runEngine, invalidateEngineCache } from '../src/lib/intelligence/engine';
import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { present } from '../src/lib/intelligence/present';

function verify() {
  console.log('=== Verifying Defect Fixes ===\n');
  
  invalidateEngineCache();
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection, 0);
  
  console.log(`Total records processed: ${records.length}`);
  if (records.length === 0) {
    console.log('No records found - database may be empty');
    return;
  }
  
  // Check Defect 2: Trace hashes
  console.log('\n--- Defect 2: Trace Identity Hashes ---');
  const sampleRecord = records[0];
  console.log('Record jobHash:', sampleRecord.jobHash);
  console.log('Has trace:', !!sampleRecord.trace);
  console.log('Has candidateProjectionHash:', !!sampleRecord.trace?.candidateProjectionHash);
  console.log('Has opportunityContentHash:', !!sampleRecord.trace?.opportunityContentHash);
  console.log('candidateProjectionHash value:', sampleRecord.trace?.candidateProjectionHash?.substring(0, 16));
  console.log('opportunityContentHash value:', sampleRecord.trace?.opportunityContentHash?.substring(0, 16));
  
  // Count how many have hashes
  const withHashes = records.filter(r => r.trace?.candidateProjectionHash && r.trace?.opportunityContentHash).length;
  console.log(`Records with both hashes: ${withHashes}/${records.length}`);
  
  // Check Defect 3: Presenter confidence
  console.log('\n--- Defect 3: Presenter Confidence Purity ---');
  const testRecord = records.find(r => r.priority === null) || records[0];
  const mockOp = {
    jobHash: testRecord.jobHash,
    role: 'Test',
    company: 'Test',
    dimensions: [],
    originalOpportunity: {}
  } as any;
  
  const presented = present(mockOp, testRecord, projection);
  console.log('Record confidence:', testRecord.confidence);
  console.log('UI decisionConfidence.overall:', presented.opportunity.recommendationResult?.decisionConfidence?.overall);
  console.log('Match:', testRecord.confidence === presented.opportunity.recommendationResult?.decisionConfidence?.overall);
  
  // Check values are not fabricated 0.80
  const checks = records.slice(0, 5).map(r => {
    const p = present(mockOp, r, projection);
    return p.opportunity.recommendationResult?.decisionConfidence?.overall !== 0.80;
  });
  console.log('No fabricated 0.80 confidence:', checks.every(Boolean));
  
  console.log('\n=== Verification Complete ===');
}

verify();
