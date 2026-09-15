import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SourceSnapshotResolver } from '../../src/lib/provenance/SourceSnapshotResolver';
import { readAuthoritativeSliceInput } from '../../src/dossier/source-authority';
import { computeContentHash } from '../../src/lib/domain/canonical_identity';
import type { DatabaseAdapter, QueryParams } from '../../src/data/database/adapter';

class TestAdapter implements DatabaseAdapter {
  constructor(private readonly raw: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> { return this.raw.prepare(sql).get(...(params ?? [])) as T ?? null; }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> { return this.raw.prepare(sql).all(...(params ?? [])) as T[]; }
  async execute(sql: string, params?: QueryParams) { const result = this.raw.prepare(sql).run(...(params ?? [])); return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid }; }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> { return fn(this); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('dossier immutable source authority', () => {
  it('requires an explicit opportunity version and document set, then resolves their exact snapshots', async () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE opportunity_versions (id TEXT, canonical_job_id TEXT, content_hash TEXT, job_title TEXT, company_name TEXT, location TEXT, employment_type TEXT, raw_content TEXT, source_payload_key TEXT, source_media_type TEXT);
      CREATE TABLE candidate_documents (id TEXT, person_id TEXT, document_hash TEXT, mime_type TEXT);
      CREATE TABLE document_contents (document_id TEXT, raw_text TEXT, text_hash TEXT);`);
    raw.prepare('INSERT INTO opportunity_versions VALUES (?,?,?,?,?,?,?,?,?,?)').run('version-1','job-1',hash('ignored'),'Head of Growth','Example Co','Delhi','Full-time','Immutable job text',null,null);
    // The resolver recomputes the canonical identity hash; this test only exercises text snapshots, so use matching content identity fields.
    const contentHash = computeContentHash({title:'Head of Growth',companyName:'Example Co',location:'Delhi',employmentType:'Full-time',rawContent:'Immutable job text'});
    raw.prepare('UPDATE opportunity_versions SET content_hash = ?').run(contentHash);
    raw.prepare('INSERT INTO candidate_documents VALUES (?,?,?,?)').run('cv-1','person-1','doc-hash','text/plain');
    raw.prepare('INSERT INTO document_contents VALUES (?,?,?)').run('cv-1','Immutable candidate text',hash('Immutable candidate text'));
    const db = new TestAdapter(raw);
    const resolver = new SourceSnapshotResolver(db);
    const input = await readAuthoritativeSliceInput({canonicalJobId:'job-1',opportunityVersion:'version-1',personId:'person-1',candidateDocumentIds:['cv-1'],candidateName:'Candidate'}, {db,resolver});
    expect(input.sources.map(source => source.text)).toEqual(['Immutable job text','Immutable candidate text']);
    await expect(readAuthoritativeSliceInput({canonicalJobId:'job-1',opportunityVersion:'version-1',personId:'person-1',candidateDocumentIds:[],candidateName:'Candidate'}, {db,resolver})).rejects.toThrow('explicit candidate document set');
  });
});
