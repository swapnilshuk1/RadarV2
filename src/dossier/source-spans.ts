import { z } from 'zod';
import { claimSchema, type EvidenceSource } from './contracts';

export const sourceClaimsSchema = z.object({ claims: claimSchema.extend({
  citations: z.array(z.object({ sourceId: z.string(), spanId: z.string() })),
}).array() });

/** Number verbatim source passages before the model sees them. No rewriting,
 * truncation, fuzzy matching or quotation repair takes place after extraction. */
export function sourceSpans(source: EvidenceSource) {
  let cursor = 0;
  return source.text.split(/(?:\r?\n)+|(?<=[.!?])(?:\s+(?=[A-Z])|(?=[A-Z]))/u).filter(text => text.trim()).map((text, index) => {
    const start = source.text.indexOf(text, cursor);
    cursor = start + text.length;
    return { id: `s${index}`, text, start, end: cursor };
  });
}

export function resolveSourceClaims(value: unknown, sources: EvidenceSource[]) {
  const result = sourceClaimsSchema.parse(value);
  return result.claims.map((claim, index) => {
    const prefixMatch = claim.id.match(/^([A-Z]+-\d+-)/);
    // The model selects evidence, not identifiers. Its repeated or malformed
    // suffixes must not collapse independently grounded claims from one source.
    // A source-scoped ordinal remains stable for the research and prose stages.
    const cleanId = prefixMatch ? `${prefixMatch[1]}${index + 1}` : claim.id;
    return {
      ...claim,
      id: cleanId,
      citations: claim.citations.map(ref => {
        const source = sources.find(s => s.id === ref.sourceId);
        const span = source && sourceSpans(source).find(s => s.id === ref.spanId);
        if (!span) throw new Error(`Unknown source passage ${ref.sourceId}/${ref.spanId}`);
        return { sourceId: ref.sourceId, quote: span.text };
      }),
    };
  });
}
