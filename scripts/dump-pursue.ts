import { runEngine, readOpportunities } from '../src/lib/intelligence/engine';
import { candidateProfile } from '../src/data/candidate-profile';
import { CandidateProjectionBuilder } from '../src/lib/intelligence/builders/CandidateProjectionBuilder';
import { JobProjectionBuilder } from '../src/lib/intelligence/builders/JobProjectionBuilder';
import fs from 'fs';
import path from 'path';

const { records } = runEngine();
const pursueRecords = records.filter(r => r.verb === 'PURSUE');
console.log('Pursue count:', pursueRecords.length);

const candProjV4 = CandidateProjectionBuilder.build(candidateProfile);
const opps = readOpportunities();

const results = [];
for (const rec of pursueRecords) {
  const raw = opps.find(o => o.jobHash === rec.id || o.id === rec.id) || opps.find(o => (o.title || (o as any).canonicalTitle) === rec.role);
  const jobProjV4 = raw ? JobProjectionBuilder.build(raw) : null;
  results.push({ record: rec, rawOpportunity: raw, jobProjection: jobProjV4 });
}

const outDir = path.resolve(process.cwd(), 'scratch');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outFile = path.join(outDir, 'pursue_details.json');
fs.writeFileSync(outFile, JSON.stringify({ candidateProfile, candProjV4, pursueJobs: results }, null, 2));
console.log('Successfully written file to:', outFile);
