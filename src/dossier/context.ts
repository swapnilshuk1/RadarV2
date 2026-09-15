import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import type { AcquisitionAttempt, ContextProvider, EvidenceSource, SliceInput } from './contracts';

/** Trusted application configuration, never model-generated URLs. Other providers
 * (search, registries, market data) implement the same acquisition boundary. */
export class CompanyWebsiteProvider implements ContextProvider {
  readonly id = 'company-website';
  constructor(private pages: { url: string; title: string }[], private request: typeof fetch = fetch) {
    for (const page of pages) if (new URL(page.url).protocol !== 'https:') throw new Error('Context pages require HTTPS');
  }
  async acquire(_opportunity: SliceInput['opportunity'], fields: readonly string[]) {
    const sources: EvidenceSource[] = [];
    const outcomes = await Promise.all(this.pages.map(async page => {
      try {
        const response = await this.request(page.url, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { 'User-Agent': 'RADAR-Research/1.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const $ = load(await response.text());
        $('script, style, nav, header, footer, noscript').remove();
        const text = $('main').length ? $('main').text() : $('body').text();
        // Whitespace normalization happens at source acquisition, before quote offsets exist.
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) throw new Error('No readable source text');
        sources.push({ id: `context-${createHash('sha256').update(page.url + normalized).digest('hex').slice(0,16)}`, plane: 'CONTEXT', title: page.title, locator: page.url, text: normalized, capturedAt: new Date().toISOString(), attribution: 'COMPANY_PUBLISHED' });
        return `${page.url}: retrieved`;
      } catch (error) { return `${page.url}: ${error instanceof Error ? error.message : 'unavailable'}`; }
    }));
    const attempts: AcquisitionAttempt[] = fields.map(field => ({ provider: this.id, field, operation: 'retrieve', status: sources.length ? 'ACQUIRED' : 'UNAVAILABLE', sourceIds: sources.map(s => s.id), detail: `Retrieved pages for field resolution; this does not mean the field is answered. ${outcomes.join('; ')}` }));
    return { sources, attempts };
  }
}
