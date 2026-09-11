import type { DatabaseAdapter } from '../../database/adapter';
import { canonical, snapshot, type KnowledgeSnapshot, type KnowledgeClaim } from '../../../lib/intelligence/knowledge/model';
import { digest } from '../../../lib/intelligence/knowledge/model';
import type { SourceDocument } from '../../../lib/intelligence/knowledge/documents';

/** Explicit persistence boundary. Shadow runner does not call this write API. */
export class SqliteIntelligenceStore {
  constructor(private db: DatabaseAdapter, private tenantId: string) { if (!tenantId) throw new Error('Tenant required'); }
  async save(value: KnowledgeSnapshot): Promise<void> {
    snapshot(value.sources,value.claims,value.edges);
    await this.db.transaction(async tx => {
      for (const source of value.sources) {
        const prior=await tx.one<{source_json:string}>('SELECT source_json FROM intelligence_sources WHERE tenant_id=? AND id=?',[this.tenantId,source.id]);
        if(prior && prior.source_json!==canonical(source)) throw new Error('Immutable intelligence source collision');
        await tx.execute('INSERT OR IGNORE INTO intelligence_sources(tenant_id,id,source_json) VALUES(?,?,?)', [this.tenantId,source.id,canonical(source)]);
      }
      for (const c of value.claims) {
        const prior=await tx.one<{claim_json:string}>('SELECT claim_json FROM intelligence_claims WHERE tenant_id=? AND id=?',[this.tenantId,c.id]);
        if(prior && prior.claim_json!==canonical(c)) throw new Error('Immutable intelligence claim collision');
        await tx.execute('INSERT OR IGNORE INTO intelligence_claims(tenant_id,id,subject_type,subject_id,predicate,claim_json) VALUES(?,?,?,?,?,?)', [this.tenantId,c.id,c.subject.type,c.subject.id,c.predicate,canonical(c)]);
      }
      for (const e of value.edges) await tx.execute('INSERT OR IGNORE INTO intelligence_claim_edges(tenant_id,from_id,to_id,relation) VALUES(?,?,?,?)', [this.tenantId,e.from,e.to,e.relation]);
    });
  }
  async claimsFor(subjectId: string): Promise<KnowledgeClaim[]> {
    const rows = await this.db.many<{claim_json:string}>('SELECT claim_json FROM intelligence_claims WHERE tenant_id=? AND subject_id=? ORDER BY id',[this.tenantId,subjectId]);
    return rows.map(r => JSON.parse(r.claim_json) as KnowledgeClaim);
  }
  /** Retains exact retrieved text separately from claims; claims never hide their source. */
  async saveSourceDocument(document: SourceDocument): Promise<void> {
    const hash=digest(document.text);
    if(document.source.contentHash && document.source.contentHash!==hash)throw new Error('Source document content hash mismatch');
    await this.db.transaction(async tx=>{
      const source={...document.source,contentHash:hash};
      const prior=await tx.one<{source_json:string}>('SELECT source_json FROM intelligence_sources WHERE tenant_id=? AND id=?',[this.tenantId,source.id]);
      if(prior&&prior.source_json!==canonical(source)){
        const previous=JSON.parse(prior.source_json) as Record<string,unknown>;const {contentHash:oldHash,...oldIdentity}=previous;const {contentHash:newHash,...newIdentity}=source;
        if(oldHash || canonical(oldIdentity)!==canonical(newIdentity))throw new Error('Immutable intelligence source collision');
        // A source registry entry may be created before its exact document is
        // retrieved. It can be completed once, never rewritten thereafter.
        await tx.execute('UPDATE intelligence_sources SET source_json=? WHERE tenant_id=? AND id=?',[canonical(source),this.tenantId,source.id]);
      } else await tx.execute('INSERT OR IGNORE INTO intelligence_sources(tenant_id,id,source_json) VALUES(?,?,?)',[this.tenantId,source.id,canonical(source)]);
      const existing=await tx.one<{content_hash:string}>('SELECT content_hash FROM intelligence_source_documents WHERE tenant_id=? AND source_id=?',[this.tenantId,source.id]);
      if(existing&&existing.content_hash!==hash)throw new Error('Immutable intelligence document collision');
      await tx.execute('INSERT OR IGNORE INTO intelligence_source_documents(tenant_id,source_id,content_hash,content) VALUES(?,?,?,?)',[this.tenantId,source.id,hash,document.text]);
    });
  }
  /** Name fallback is stable per tenant; a verified domain may be supplied once known. */
  async resolveCompany(name: string, officialDomain?: string): Promise<string> {
    const normalizedName=name.trim().toLocaleLowerCase().replace(/\s+/g,' ');
    if(!normalizedName) throw new Error('Company name required');
    const existing=await this.db.one<{id:string;official_domain:string|null}>('SELECT id,official_domain FROM intelligence_company_entities WHERE tenant_id=? AND normalized_name=?',[this.tenantId,normalizedName]);
    if(existing){
      if(officialDomain&&existing.official_domain&&existing.official_domain!==officialDomain)throw new Error('Verified company domain conflicts with existing identity');
      if(officialDomain&&!existing.official_domain)await this.db.execute('UPDATE intelligence_company_entities SET official_domain=? WHERE tenant_id=? AND id=?',[officialDomain,this.tenantId,existing.id]);
      return existing.id;
    }
    const id=`company_${digest([this.tenantId,normalizedName])}`;
    await this.db.execute('INSERT INTO intelligence_company_entities(tenant_id,id,normalized_name,official_domain) VALUES(?,?,?,?)',[this.tenantId,id,normalizedName,officialDomain??null]);
    return id;
  }
}
