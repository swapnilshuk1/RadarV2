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
    const fetchPage = async (page: { url: string; title: string }) => {
      try {
        const response = await this.request(page.url, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { 'User-Agent': 'RADAR-Research/1.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const $ = load(await response.text());
        $('script, style, nav, header, footer, noscript').remove();
        const text = $('main').length ? $('main').text() : $('body').text();
        // Whitespace normalization happens at source acquisition, before quote offsets exist.
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) throw new Error('No readable source text');
        const origin = new URL(page.url).origin;
        const related = $('a[href]').toArray().map(anchor => {
          const label = $(anchor).text().replace(/\s+/g, ' ').trim();
          const href = $(anchor).attr('href');
          if (!href) return null;
          const url = new URL(href, page.url);
          return url.origin === origin && /(?:about|company|project|leadership|career|life|news|media)/i.test(`${label} ${url.pathname}`) ? { url: url.href.split('#')[0], title: `${page.title} — ${label || url.pathname}` } : null;
        }).filter((item): item is { url: string; title: string } => Boolean(item));
        return { source: { id: `context-${createHash('sha256').update(page.url + normalized).digest('hex').slice(0,16)}`, plane: 'CONTEXT' as const, title: page.title, locator: page.url, text: normalized, capturedAt: new Date().toISOString(), attribution: 'COMPANY_PUBLISHED' as const }, related, outcome: `${page.url}: retrieved` };
      } catch (error) { return { related: [], outcome: `${page.url}: ${error instanceof Error ? error.message : 'unavailable'}` }; }
    };
    const first = await Promise.all(this.pages.map(fetchPage));
    const configured = new Set(this.pages.map(page => new URL(page.url).href));
    const discovered = [...new Map(first.flatMap(result => result.related)
      .filter(page => !configured.has(new URL(page.url).href))
      .map(page => [new URL(page.url).href, page])).values()].slice(0, 2);
    const second = await Promise.all(discovered.map(fetchPage));
    const all = [...first, ...second];
    const sources = [...new Map(all.flatMap(result => result.source ? [result.source] : []).map(source => [source.id, source])).values()];
    const outcomes = all.map(result => result.outcome);
    const attempts: AcquisitionAttempt[] = fields.map(field => ({ provider: this.id, field, operation: 'retrieve', status: sources.length ? 'ACQUIRED' : 'UNAVAILABLE', sourceIds: sources.map(s => s.id), detail: `Retrieved pages for field resolution; this does not mean the field is answered. ${outcomes.join('; ')}` }));
    return { sources, attempts };
  }
}
