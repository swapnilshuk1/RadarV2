import { digest } from './model';
import { segmentDocument, type DocumentSection, type DocumentSectionKind, type SourceDocument } from './documents';
import type { JsonModel } from './model-provider';

const kinds = new Set<DocumentSectionKind>([
  'ROLE_SUMMARY', 'RESPONSIBILITIES', 'OUTCOMES', 'QUALIFICATIONS',
  'ABOUT_COMPANY', 'BUSINESS_CONTEXT', 'TEAM_CONTEXT', 'BENEFITS',
  'LEGAL_EEO', 'OTHER',
]);

export interface SemanticDocumentSegment {
  kind: DocumentSectionKind;
  quote: string;
  confidence: number;
}

/**
 * Uses a model only to classify possible spans. Every proposed span is then
 * resolved verbatim against the exact pinned document. An unresolved span is a
 * local omission; it can never invalidate the document or create text.
 */
export class FullDocumentSemanticSegmenter {
  readonly version = 'full-document-semantic-segmentation/1';
  constructor(private readonly model: JsonModel, private readonly chunkSize = 4200, private readonly overlap = 600) {}

  async segment(source: SourceDocument): Promise<DocumentSection[]> {
    const proposals: SemanticDocumentSegment[] = [];
    for (const chunk of chunks(source.text, this.chunkSize, this.overlap)) {
      try {
        const response = await this.model.generate(
          `Classify contiguous semantic sections in this job document chunk. Return only JSON {segments:[{kind,quote,confidence}]}. kind must be one of ROLE_SUMMARY, RESPONSIBILITIES, OUTCOMES, QUALIFICATIONS, ABOUT_COMPANY, BUSINESS_CONTEXT, TEAM_CONTEXT, BENEFITS, LEGAL_EEO, OTHER. quote must be an exact contiguous substring from the supplied chunk. Do not summarize, repair, or invent text. Use OTHER when uncertain.`,
          { chunk: chunk.text, absoluteStart: chunk.start },
        );
        if (!response || typeof response !== 'object' || !Array.isArray((response as any).segments)) continue;
        for (const candidate of (response as any).segments) {
          if (typeof candidate?.kind !== 'string' || !kinds.has(candidate.kind) || typeof candidate?.quote !== 'string' || !candidate.quote || typeof candidate?.confidence !== 'number') continue;
          if (!chunk.text.includes(candidate.quote)) continue;
          proposals.push(candidate as SemanticDocumentSegment);
        }
      } catch {
        // Semantic classification is optional enrichment. Retain deterministic
        // coverage below when a provider is unavailable or returns bad JSON.
      }
    }
    const resolved = resolve(source, proposals);
    return resolved.length ? completeCoverage(source, resolved) : segmentDocument(source);
  }
}

function chunks(text: string, size: number, overlap: number) {
  const result: Array<{ start: number; text: string }> = [];
  for (let start = 0; start < text.length; start += Math.max(1, size - overlap)) result.push({ start, text: text.slice(start, start + size) });
  return result;
}

function resolve(source: SourceDocument, proposals: SemanticDocumentSegment[]): DocumentSection[] {
  const seen = new Set<string>();
  return proposals
    .map(proposal => {
      const start = source.text.indexOf(proposal.quote);
      const end = start < 0 ? -1 : start + proposal.quote.length;
      const key = `${start}:${end}:${proposal.kind}`;
      if (start < 0 || seen.has(key)) return undefined;
      seen.add(key);
      return { id: digest([source.source.id, proposal.kind, start, end]), sourceId: source.source.id, contentHash: digest(source.text), kind: proposal.kind, start, end, text: proposal.quote } satisfies DocumentSection;
    })
    .filter((value): value is DocumentSection => Boolean(value))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

function completeCoverage(source: SourceDocument, sections: DocumentSection[]): DocumentSection[] {
  const disjoint = sections.filter((section, index) => !sections.some((other, otherIndex) => otherIndex !== index && other.start <= section.start && other.end >= section.end && (other.start < section.start || other.end > section.end)));
  const result: DocumentSection[] = [];
  let cursor = 0;
  for (const section of disjoint) {
    if (section.start > cursor) result.push(other(source, cursor, section.start));
    if (section.start >= cursor) { result.push(section); cursor = section.end; }
  }
  if (cursor < source.text.length) result.push(other(source, cursor, source.text.length));
  return result;
}
function other(source: SourceDocument, start: number, end: number): DocumentSection {
  return { id: digest([source.source.id, 'OTHER', start, end]), sourceId: source.source.id, contentHash: digest(source.text), kind: 'OTHER', start, end, text: source.text.slice(start, end) };
}
