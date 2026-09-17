import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { EvidenceSource, SliceInput } from '../../src/dossier/contracts';

/** Whitelist raw inputs. Old projections, evaluations, context claims and dossier
 * copy in a case export never enter the reasoning request. */
export async function readSliceInput(casesPath: string, caseId: string, candidatePaths: string[]): Promise<SliceInput> {
  const lines = (await readFile(casesPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  const entry = lines.map(line => JSON.parse(line)).find(row => row.caseId === caseId);
  if (!entry || typeof entry.job?.rawText !== 'string' || !entry.job.rawText.trim()) throw new Error(`Case ${caseId} has no raw JD`);
  if (!candidatePaths.length) throw new Error('At least one candidate source is required');
  const capturedAt = new Date().toISOString();
  const source = (text: string, locator: string, title: string, plane: EvidenceSource['plane']): EvidenceSource => ({
    id: `${plane.toLowerCase()}-${createHash('sha256').update(locator + text).digest('hex').slice(0,16)}`,
    text, locator, title, plane, capturedAt, attribution: plane === 'JD' ? 'JOB_POST' : 'CANDIDATE_SUPPLIED',
  });
  const candidates = await Promise.all(candidatePaths.map(async file => source(await readFile(file, 'utf8'), resolve(file), file.split(/[\\/]/).pop()!, 'CANDIDATE')));
  return { opportunity: { id: entry.identity.canonicalJobId, company: entry.company, title: entry.role }, candidate: { name: 'Swapnil Shukla' },
    sources: [source(entry.job.rawText, `${resolve(casesPath)}#case=${caseId}/job.rawText`, `${entry.company} — original exported JD`, 'JD'), ...candidates] };
}
