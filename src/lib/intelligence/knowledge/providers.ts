import { load } from 'cheerio';
import { digest, type KnowledgeClaim, type KnowledgeSnapshot, snapshot } from './model';
import { extractCompanySections, type SourceDocument } from './documents';

export interface IntelligenceTask { type: string; subjectId: string; parameters?: Record<string, unknown> }
export interface IntelligenceContext { companyId: string; observedAt: string; documents: readonly SourceDocument[] }
export interface SourceCandidate { id: string; uri?: string; document?: SourceDocument }
export interface IntelligenceConnector {
  id: string;
  supports(task: IntelligenceTask): boolean;
  discover(task: IntelligenceTask, context: IntelligenceContext): Promise<SourceCandidate[]>;
  fetch(candidate: SourceCandidate): Promise<SourceDocument>;
}
export interface ClaimExtractor { extract(source: SourceDocument, context: IntelligenceContext): Promise<KnowledgeClaim[]> }
export interface ClaimSynthesizer { synthesize(claims: KnowledgeClaim[], context: IntelligenceContext): Promise<KnowledgeClaim[]> }
export class JobDocumentConnector implements IntelligenceConnector {
  id = 'canonical-job-document';
  supports(task: IntelligenceTask) { return task.type === 'EXTRACT_JOB_DOCUMENT'; }
  async discover(_task: IntelligenceTask, context: IntelligenceContext) { return context.documents.map(document => ({ id: document.source.id, document })); }
  async fetch(candidate: SourceCandidate) { if (!candidate.document) throw new Error('Exact version document unavailable'); return candidate.document; }
}
export class InternalCorpusConnector implements IntelligenceConnector {
  id = 'internal-corpus';
  /** The loader is supplied by the owning repository boundary; this connector
   * never reaches into application storage on its own. */
  constructor(private readonly loader: (task: IntelligenceTask, context: IntelligenceContext) => Promise<SourceDocument[]> = async () => []) {}
  supports(task: IntelligenceTask) { return task.type === 'RESEARCH_COMPANY_EVENTS' || task.type === 'ANALYZE_COMPANY_HIRING_PATTERN'; }
  async discover(task: IntelligenceTask, context: IntelligenceContext) {
    return (await this.loader(task, context)).map(document => ({ id: document.source.id, document }));
  }
  async fetch(candidate: SourceCandidate) {
    if (!candidate.document) throw new Error('Internal corpus source unavailable');
    return candidate.document;
  }
}
export class EmployerSectionExtractor implements ClaimExtractor {
  async extract(source: SourceDocument, context: IntelligenceContext) { return extractCompanySections(source, context.companyId); }
}
/** Only explicitly resolved official domains are accepted; discovery never guesses a company domain. */
export class OfficialCompanyConnector implements IntelligenceConnector {
  id = 'official-company-web';
  constructor(private origin: string, private retrievedAt: string, private request: typeof fetch = fetch) {
    const url = new URL(origin); if (url.protocol !== 'https:' || url.username || url.password || !isPublicHost(url.hostname)) throw new Error('Official origin must be a public HTTPS host');
  }
  supports(task: IntelligenceTask) { return task.type === 'ENRICH_COMPANY_PROFILE'; }
  async discover() {
    const response = await this.request(new URL('/',this.origin),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Official discovery returned ${response.status}`);
    const $=load(await response.text()); const urls=new Set<string>([new URL('/',this.origin).href]);
    $('a[href]').each((_i,node)=>{try{const url=new URL($(node).attr('href')!,this.origin);if(url.origin===new URL(this.origin).origin && /about|company|news|press|investor|leadership|products|careers/i.test(url.pathname)){url.hash='';urls.add(url.href);}}catch{/* Invalid link is not a discovered source. */}});
    return [...urls].sort().slice(0,12).map(uri=>({id:digest(uri),uri}));
  }
  async fetch(candidate: SourceCandidate): Promise<SourceDocument> {
    if (!candidate.uri || new URL(candidate.uri).origin !== new URL(this.origin).origin) throw new Error('Unresolved official source');
    const response = await this.request(candidate.uri, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Official source returned ${response.status}`);
    const html = await response.text(); const $ = load(html); $('script,style,nav,footer,form').remove();
    $('h1,h2,h3,h4,p,li,br').each((_i,node)=>{$(node).before('\n').after('\n');});
    return { source: { id: digest([candidate.uri,digest(html),this.retrievedAt]), provider: this.id, kind: 'COMPANY_WEBSITE', authority: 'PRIMARY', uri: candidate.uri, title: $('title').text(), retrievedAt: this.retrievedAt, contentHash: digest(html) }, text: $('main').text().trim() || $('body').text().trim() };
  }
}
function isPublicHost(host:string):boolean {
  const value=host.toLowerCase();
  if(value==='localhost'||value.endsWith('.localhost')||value.endsWith('.local'))return false;
  const octets=value.split('.').map(Number);
  if(octets.length===4&&octets.every(Number.isInteger)){
    const [a,b]=octets;
    if(a===10||a===127||a===0||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168)return false;
  }
  return true;
}
export class IntelligencePipeline {
  private cache = new Map<string, KnowledgeSnapshot>();
  constructor(private connectors: readonly IntelligenceConnector[], private extractor: ClaimExtractor, private synthesizers: readonly ClaimSynthesizer[] = []) {}
  async run(task: IntelligenceTask, context: IntelligenceContext): Promise<{ snapshot: KnowledgeSnapshot; errors: string[] }> {
    const documents: SourceDocument[] = []; const errors: string[] = [];
    for (const connector of this.connectors.filter(c => c.supports(task))) {
      try { for (const candidate of await connector.discover(task, context)) {
        try { documents.push(await connector.fetch(candidate)); } catch (error) { errors.push(`${connector.id}:${candidate.id}:${String(error)}`); }
      } } catch (error) { errors.push(`${connector.id}:${String(error)}`); }
    }
    const key = digest([context.companyId, documents.map(d => [d.source.id, digest(d.text)]).sort(), 'pipeline/1']);
    const prior = this.cache.get(key); if (prior) return { snapshot: prior, errors };
    const claims = (await Promise.all(documents.map(d => this.extractor.extract(d, context)))).flat();
    for (const synthesizer of this.synthesizers) claims.push(...await synthesizer.synthesize(claims, context));
    const result = snapshot([...new Map(documents.map(d => [d.source.id, d.source])).values()], [...new Map(claims.map(c => [c.id, c])).values()]);
    this.cache.set(key, result); return { snapshot: result, errors };
  }
}
