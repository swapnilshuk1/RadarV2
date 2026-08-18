import { CandidateProjectionBuilderImpl } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { candidateProfile } from '../src/data/candidate-profile';
import { runEngine } from '../src/lib/intelligence/engine';

const builder = new CandidateProjectionBuilderImpl();
const proj = builder.fromProfile(candidateProfile);
const { records } = runEngine(proj as any, 0);

// Find records where trace.pipeline contains a Career stage with status indicating regression
const found = records.filter(r => {
  const pipeline = r.trace?.pipeline || [];
  return pipeline.some(p => p.stage === 'Career' && (typeof p.reason === 'string' ? p.reason.toLowerCase().includes('regression') : (p.status && (String(p.status).toLowerCase().includes('regression')))));
});

if (found.length === 0) {
  console.log('No explicit career regression pipeline stage found. Searching for career.regressionScore in record.explanation or trace...');
  const alt = records.filter(r => (r.trace && r.trace.careerValueBreakdown) || (r.explanation && r.explanation.dominantFactor && String(r.explanation.dominantFactor).toLowerCase().includes('regression')));
  if (alt.length === 0) {
    console.log('No candidate career regression records found in trace or explanation.');
  } else {
    console.log('Found alt candidates:', alt.slice(0,5).map(r => ({ jobHash: r.jobHash, vetoReason: r.vetoReason, priority: r.priority, trace: r.trace?.careerValueBreakdown || null }))); 
  }
} else {
  console.log('Found career-regression candidates:', found.slice(0,5).map(r => ({ jobHash: r.jobHash, vetoReason: r.vetoReason, priority: r.priority, trace: r.trace?.careerValueBreakdown || null }))); 
}

