import { z } from 'zod';
import { claimSchema, type EvidenceSource } from './contracts';

export const sourceClaimsSchema = z.object({ claims: claimSchema.extend({
  state: z.literal('EXPLICIT'),
  citations: z.array(z.object({ sourceId: z.string(), spanId: z.string() })),
  derivedFrom: z.array(z.string()).max(0),
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
  const pattern = /(?:[^\r\n.!?]+(?:[.!?]+|(?=\r?\n)|$)|\r?\n+)/gu;
  for (const match of source.text.matchAll(pattern)) {
    const text = match[0];
    if (!text.trim() || /^\r?\n+$/u.test(text)) continue;
    const start = match.index ?? 0;
    initial.push({ text, start, end: start + text.length });
  }
  return initial.flatMap(span => subdivideVerbatim(span.text, span.start)).map((span, index) => ({ id: `s${index}`, ...span }));
}

const CONTEXT_SUPPORT_TERMS: Array<{claim:RegExp;support:RegExp;label:string}> = [
  {claim:/\b(?:employees?|headcount|workforce|staff)\b/i,support:/\b(?:employees?|headcount|workforce|staff)\b/i,label:'employee/headcount'},
  {claim:/\bfollowers?\b/i,support:/\bfollowers?\b/i,label:'followers'},
  {claim:/\b(?:founded|founding|established)\b/i,support:/\b(?:founded|founding|established)\b/i,label:'founded/established'},
  {claim:/\b(?:funding|funded|investors?|rounds?|raised|bootstrapped)\b/i,support:/\b(?:funding|funded|investors?|rounds?|raised|bootstrapped)\b/i,label:'funding'},
  {claim:/\b(?:co[- ]?founders?|founders?)\b/i,support:/\b(?:co[- ]?founders?|founders?)\b/i,label:'founder'},
  {claim:/\b(?:CEOs?|CMOs?|CFOs?|COOs?|CTOs?|chief executives?|chief marketing|chief financial|chief operating|chief technology)\b/i,support:/\b(?:CEOs?|CMOs?|CFOs?|COOs?|CTOs?|chief executives?|chief marketing|chief financial|chief operating|chief technology)\b/i,label:'executive title'},
  {claim:/\b(?:office|locations?|headquarter(?:s|ed)?|based in)\b/i,support:/\b(?:office|locations?|headquarter(?:s|ed)?|based in)\b/i,label:'location'},
  {claim:/\bindustry\b/i,support:/\bindustry\b/i,label:'industry'},
  {claim:/\b(?:strategists?|directors?|managers?|presidents?)\b/i,support:/\b(?:strategists?|directors?|managers?|presidents?)\b/i,label:'role title'},
];

function normalizedNumber(value:string):string {
  return value.replace(/,/g,'').replace(/^0+(?=\d)/,'');
}

function assertDirectContextClaimSupport(
  claim:z.infer<typeof sourceClaimsSchema>['claims'][number],
  citations:Array<{sourceId:string;quote:string}>,
  sources:EvidenceSource[],
) {
  if(claim.plane!=='CONTEXT')return;
  const support=citations.map(citation=>citation.quote).join(' ');
  const missing:string[]=[];
  const supportNumbers=new Set(
    [...support.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)].map(match=>normalizedNumber(match[0])),
  );
  for(const number of [...claim.text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)].map(match=>normalizedNumber(match[0]))){
    if(!supportNumbers.has(number))missing.push(`number ${number}`);
  }
  for(const rule of CONTEXT_SUPPORT_TERMS){
    if(rule.claim.test(claim.text)&&!rule.support.test(support))missing.push(rule.label);
  }

  const citedSourceIdentityTokens=new Set(
    citations.flatMap(citation=>{
      const source=sources.find(candidate=>candidate.id===citation.sourceId);
      const firstLine=source?.text.split(/\r?\n/).map(line=>line.trim()).find(Boolean)??'';
      const identityText=`${source?.title??''} ${firstLine}`;
      return [...identityText.matchAll(/\b[A-Z][a-z][A-Za-z'’-]*\b/g)]
        .map(match=>match[0].toLocaleLowerCase());
    }),
  );
  const supportLower=support.toLocaleLowerCase();
  const namedPhrases=[...claim.text.matchAll(/\b([A-Z][a-z][A-Za-z'’-]*(?:(?:\s+|,\s*)[A-Z][a-z][A-Za-z'’-]*)+)\b/g)]
    .map(match=>match[1]!);
  for(const phrase of new Set(namedPhrases)){
    const tokens=phrase.split(/\s+/)
      .filter(token=>!citedSourceIdentityTokens.has(token.toLocaleLowerCase()));
    if(tokens.length<2)continue;
    const absent=tokens.filter(token=>!supportLower.includes(token.toLocaleLowerCase()));
    if(absent.length)missing.push(`name/location ${absent.join(' ')}`);
  }

  if(missing.length){
    throw new Error(
      `Explicit context claim lacks direct cited support: ${claim.id}; missing ${[...new Set(missing)].join(', ')}. Cite the exact supporting passage(s) or remove the claim.`,
    );
  }
}

export function resolveSourceClaims(value: unknown, sources: EvidenceSource[]) {
  const result = sourceClaimsSchema.parse(value);
  const issues: string[] = [];
  const resolved = result.claims.map((claim, index) => {
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
      if (indices.some((value, position) => position > 0 && value !== indices[position - 1] + 1)) issues.push(`${claim.id}: citations from ${sourceId} must use contiguous source passages; received ${indices.map(i => `s${i}`).join(', ')}`);
    }
    const prefixMatch = claim.id.match(/^([A-Z]+-\d+-)/);
    // The model selects evidence, not identifiers. Its repeated or malformed
    // suffixes must not collapse independently grounded claims from one source.
    // A source-scoped ordinal remains stable for the research and prose stages.
    const cleanId = prefixMatch ? `${prefixMatch[1]}${index + 1}` : claim.id;
    const citations = claim.citations.map(ref => {
      const source = sources.find(s => s.id === ref.sourceId);
      const span = source && sourceSpans(source).find(s => s.id === ref.spanId);
      if (!span) throw new Error(`Unknown source passage ${ref.sourceId}/${ref.spanId}`);
      return { sourceId: ref.sourceId, quote: span.text };
    });
    assertDirectContextClaimSupport(claim, citations, sources);
    return {
      ...claim,
      id: cleanId,
      citations,
    };
  });
  if (issues.length) throw new Error(`${issues.join('; ')}. Fix every listed claim: choose the minimal adjacent support or split independently supported assertions into separate claims. Do not bridge unrelated passages or duplicate a span.`);
  return resolved;
}
