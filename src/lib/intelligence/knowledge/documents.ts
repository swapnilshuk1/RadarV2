import { digest, type IntelligenceSource, type KnowledgeClaim, claim } from './model';

export interface SourceDocument { source: IntelligenceSource; text: string }
export type DocumentSectionKind = 'ROLE_SUMMARY' | 'RESPONSIBILITIES' | 'OUTCOMES' | 'QUALIFICATIONS' | 'ABOUT_COMPANY' | 'BUSINESS_CONTEXT' | 'TEAM_CONTEXT' | 'BENEFITS' | 'LEGAL_EEO' | 'OTHER';
export interface DocumentSection { id: string; sourceId: string; contentHash: string; start: number; end: number; text: string; kind: DocumentSectionKind }
const headings: Array<[RegExp, DocumentSectionKind]> = [
  [/^(?:about (?:us|(?:the )?company)|company (?:overview|profile))\s*:?[ \t]*$/i, 'ABOUT_COMPANY'],
  [/^(?:about (?:the role|this role)|role (?:overview|summary))\s*:?[ \t]*$/i, 'ROLE_SUMMARY'],
  [/^(?:key )?(?:responsibilities|duties|what you.ll do)\s*:?[ \t]*$/i, 'RESPONSIBILITIES'],
  [/^(?:qualifications|requirements|required skills|what you bring)\s*:?[ \t]*$/i, 'QUALIFICATIONS'],
  [/^(?:outcomes|success measures|success metrics)\s*:?[ \t]*$/i, 'OUTCOMES'],
  [/^(?:benefits|what we offer)\s*:?[ \t]*$/i, 'BENEFITS'],
  [/^(?:equal opportunity|legal|eeo)\s*:?[ \t]*$/i, 'LEGAL_EEO'],
  [/^(?:business context|our business)\s*:?[ \t]*$/i, 'BUSINESS_CONTEXT'],
  [/^(?:the team|team context|our team)\s*:?[ \t]*$/i, 'TEAM_CONTEXT'],
];
const embeddedHeadings: Array<[RegExp, DocumentSectionKind]> = [
  [/\b(?:ABOUT US|ABOUT THE COMPANY|COMPANY OVERVIEW|COMPANY PROFILE)\b/g, 'ABOUT_COMPANY'],
  [/\b(?:ROLE OVERVIEW|ROLE SUMMARY|ABOUT THE ROLE|ABOUT THIS ROLE)\b/g, 'ROLE_SUMMARY'],
  [/\b(?:KEY RESPONSIBILITIES|RESPONSIBILITIES|DUTIES|WHAT YOU(?:'|’)LL DO)\b/g, 'RESPONSIBILITIES'],
  [/\b(?:KEY PERFORMANCE INDICATORS|SUCCESS METRICS|SUCCESS MEASURES|OUTCOMES)\b/g, 'OUTCOMES'],
  [/\b(?:REQUIRED SKILLS(?:\s*&\s*QUALIFICATIONS)?|QUALIFICATIONS|REQUIREMENTS|WHAT YOU BRING)\b/g, 'QUALIFICATIONS'],
  [/\b(?:COMPENSATION(?:\s*&\s*BENEFITS)?|BENEFITS|WHAT WE OFFER)\b/g, 'BENEFITS'],
  [/\b(?:BUSINESS CONTEXT|OUR BUSINESS)\b/g, 'BUSINESS_CONTEXT'],
  [/\b(?:TEAM CONTEXT|OUR TEAM|THE TEAM)\b/g, 'TEAM_CONTEXT'],
  [/\b(?:HOW TO APPLY|EQUAL OPPORTUNITY|LEGAL|EEO|WHAT THIS ROLE IS NOT FOR)\b/g, 'LEGAL_EEO'],
];
/** Exact UTF-16 source offsets; no truncation, whitespace rewriting or invented boundaries. */
export function segmentDocument(doc: SourceDocument): DocumentSection[] {
  const hash = digest(doc.text); const boundaries: Array<{ start: number; kind: DocumentSectionKind }> = [{ start: 0, kind: 'OTHER' }];
  for (const line of doc.text.matchAll(/^.*$/gm)) {
    const found = headings.find(([pattern]) => pattern.test(line[0].trim()));
    if (found) { if (line.index === 0) boundaries[0].kind = found[1]; else boundaries.push({ start: line.index!, kind: found[1] }); }
  }
  // Portal extraction frequently flattens rich headings into a single line.
  // Only explicit, all-capital section markers are accepted here; ordinary
  // sentence fragments never create a reconstructed document boundary.
  for (const [pattern,kind] of embeddedHeadings) for(const match of doc.text.matchAll(pattern)) {
    const text=match[0]; if(text!==text.toUpperCase() || match.index===undefined) continue;
    if(match.index===0) boundaries[0].kind=kind; else boundaries.push({start:match.index,kind});
  }
  boundaries.sort((a,b)=>a.start-b.start);
  const unique=boundaries.filter((b,i)=>i===0||b.start!==boundaries[i-1].start);
  return unique.map((b, i) => { const end = unique[i+1]?.start ?? doc.text.length;
    return { id: digest([doc.source.id, hash, b.start, end]), sourceId: doc.source.id, contentHash: hash, start: b.start, end, text: doc.text.slice(b.start, end), kind: b.kind };
  });
}
/** Employer-only API: no candidate input is accepted. Preserves company subject. */
export function extractCompanySections(doc: SourceDocument, companyId: string): KnowledgeClaim[] {
  return segmentDocument(doc).filter(s => ['ABOUT_COMPANY', 'BUSINESS_CONTEXT'].includes(s.kind)).map(s => claim({
    subject: { type: 'COMPANY', id: companyId }, predicate: s.kind === 'ABOUT_COMPANY' ? 'company.description' : 'company.business_context',
    value: { text: s.text, start: s.start, end: s.end, contentHash: s.contentHash }, displayText: s.text,
    epistemicState: 'EXTRACTED', sourceRefs: [doc.source.id], derivedFromClaimIds: [],
    generatedBy: { type: 'DETERMINISTIC', provider: 'document-sections', version: '1' }, usage: { evaluation: false, narration: true },
  }));
}
export type EndpointFitness = 'DIRECT' | 'COMPOUND' | 'ABSTRACT' | 'MALFORMED';
export function endpointFitness(text: string): EndpointFitness {
  const clean = text.trim();
  if (!clean || /\[object Object\]|[{}]|\uFFFD|KRA\d|KPI\d/.test(clean)) return 'MALFORMED';
  if (clean.split(/\s+/).length < 4 || /^[A-Z_\d &/-]+$/.test(clean)) return 'ABSTRACT';
  if (clean.includes('\n') || /;|(?:Qualifications|Responsibilities|Preferred)\s*:/i.test(clean) || clean.length > 350) return 'COMPOUND';
  return 'DIRECT';
}
