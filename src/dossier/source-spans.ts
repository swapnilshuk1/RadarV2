import { z } from 'zod';
import { claimSchema, type EvidenceSource } from './contracts';

export const sourceClaimsSchema = z.object({ claims: claimSchema.extend({
  citations: z.array(z.object({ sourceId: z.string(), spanId: z.string() })),
}).array() });

/** Number verbatim source passages before the model sees them. No rewriting,
 * truncation, fuzzy matching or quotation repair takes place after extraction. */
const MAX_LOCAL_SPAN = 320;
const MIN_PREFERRED_SPAN = 120;

function subdivideVerbatim(text: string, start: number): Array<{ text: string; start: number; end: number }> {
  if (text.length <= MAX_LOCAL_SPAN) return [{ text, start, end: start + text.length }];
  const result: Array<{ text: string; start: number; end: number }> = [];
  let offset = 0;
  while (offset < text.length) {
    const remaining = text.length - offset;
    if (remaining <= MAX_LOCAL_SPAN) {
      result.push({ text: text.slice(offset), start: start + offset, end: start + text.length });
      break;
    }
    const window = text.slice(offset, offset + MAX_LOCAL_SPAN + 1);
    const separators = [...window.matchAll(/[;|•]|\.(?=\s)|,(?=\s)/gu)].map(match => (match.index ?? 0) + match[0].length);
    const preferred = separators.filter(index => index >= MIN_PREFERRED_SPAN).at(-1);
    const whitespace = [...window.matchAll(/\s+/gu)].map(match => (match.index ?? 0) + match[0].length).filter(index => index >= MIN_PREFERRED_SPAN).at(-1);
    const cut = preferred ?? whitespace ?? MAX_LOCAL_SPAN;
    result.push({ text: text.slice(offset, offset + cut), start: start + offset, end: start + offset + cut });
    offset += cut;
  }
  return result;
}

export function sourceSpans(source: EvidenceSource) {
  const initial: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /(?:[^\r\n.!?]+(?:[.!?]+|$)|\r?\n+)/gu;
  for (const match of source.text.matchAll(pattern)) {
    const text = match[0];
    if (!text.trim() || /^\r?\n+$/u.test(text)) continue;
    const start = match.index ?? 0;
    initial.push({ text, start, end: start + text.length });
  }
  return initial.flatMap(span => subdivideVerbatim(span.text, span.start)).map((span, index) => ({ id: `s${index}`, ...span }));
}

export function resolveSourceClaims(value: unknown, sources: EvidenceSource[]) {
  const result = sourceClaimsSchema.parse(value);
  return result.claims.map((claim, index) => {
    const citedSpans = claim.citations.map(ref => {
      const source = sources.find(candidate => candidate.id === ref.sourceId);
      if (!source) throw new Error(`Unknown source passage ${ref.sourceId}/${ref.spanId}`);
      const spanIndex = sourceSpans(source).findIndex(span => span.id === ref.spanId);
      if (spanIndex < 0) throw new Error(`Unknown source passage ${ref.sourceId}/${ref.spanId}`);
      return { sourceId: ref.sourceId, spanIndex };
    });
    const spansBySource = new Map<string, number[]>();
    for (const cited of citedSpans) {
      const indices = spansBySource.get(cited.sourceId) ?? [];
      indices.push(cited.spanIndex);
      spansBySource.set(cited.sourceId, indices);
    }
    for (const [sourceId, indices] of spansBySource) {
      indices.sort((left, right) => left - right);
      if (indices.some((value, position) => position > 0 && value !== indices[position - 1] + 1)) throw new Error(`Claim citations from ${sourceId} must use contiguous source passages`);
    }
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
