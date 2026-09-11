import { createHash } from 'node:crypto';

export type EpistemicState = 'OBSERVED' | 'EXTRACTED' | 'EXTERNAL_ASSERTION' | 'INFERRED' | 'ASSUMED' | 'SYNTHESIZED';
export interface IntelligenceSource {
  id: string; provider: string; providerVersion?: string; kind: string;
  authority: 'PRIMARY' | 'AUTHORITATIVE_EXTERNAL' | 'SECONDARY' | 'MODEL' | 'UNKNOWN';
  uri?: string; title?: string; publisher?: string; publishedAt?: string;
  retrievedAt: string; contentHash?: string; rawArtifactRef?: string;
}
export interface KnowledgeClaim {
  id: string; subject: { type: string; id: string }; predicate: string;
  value: unknown; displayText?: string; epistemicState: EpistemicState;
  confidence?: number; sourceRefs: string[]; derivedFromClaimIds: string[];
  validFrom?: string; validUntil?: string; observedAt?: string;
  generatedBy: { type: 'DETERMINISTIC' | 'LLM' | 'THIRD_PARTY_API' | 'RADAR_SYNTHESIS' | 'HUMAN'; provider: string; version: string; promptVersion?: string };
  usage?: { evaluation?: boolean; narration?: boolean; questionGeneration?: boolean };
}
export interface ClaimEdge { from: string; to: string; relation: 'SUPPORTS' | 'CONTRADICTS' | 'DERIVED_FROM' | 'SUPERSEDES' }
export interface KnowledgeSnapshot { id: string; sources: IntelligenceSource[]; claims: KnowledgeClaim[]; edges: ClaimEdge[] }
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value));
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export function claim(input: Omit<KnowledgeClaim, 'id'>): KnowledgeClaim {
  if (!input.subject.id || !/^[a-z][\w-]*\.[\w.-]+$/i.test(input.predicate)) throw new Error('Claim requires subject identity and a namespaced predicate');
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) throw new Error('Invalid claim confidence');
  if (['OBSERVED', 'EXTRACTED', 'EXTERNAL_ASSERTION'].includes(input.epistemicState) && !input.sourceRefs.length) throw new Error('Source-backed claim requires a source');
  const normalized = { ...input, sourceRefs: [...new Set(input.sourceRefs)].sort(), derivedFromClaimIds: [...new Set(input.derivedFromClaimIds)].sort() };
  return { ...normalized, id: `claim_${digest(normalized)}` };
}
export function snapshot(sources: IntelligenceSource[], claims: KnowledgeClaim[], edges: ClaimEdge[] = []): KnowledgeSnapshot {
  const sourceIds = new Set(sources.map(s => s.id)); const claimIds = new Set(claims.map(c => c.id));
  for (const c of claims) {
    if (c.sourceRefs.some(id => !sourceIds.has(id)) || c.derivedFromClaimIds.some(id => !claimIds.has(id))) throw new Error(`Unresolved claim provenance: ${c.id}`);
  }
  for (const e of edges) if (!claimIds.has(e.from) || !claimIds.has(e.to)) throw new Error('Unresolved claim edge');
  const result = { sources: [...sources].sort((a,b) => a.id.localeCompare(b.id)), claims: [...claims].sort((a,b) => a.id.localeCompare(b.id)), edges: [...edges].sort((a,b) => canonical(a).localeCompare(canonical(b))) };
  return { id: digest(result), ...result };
}
export function freshness(c: KnowledgeClaim, at: string): 'CURRENT' | 'FUTURE' | 'STALE' {
  const now = Date.parse(at); if (!Number.isFinite(now)) throw new Error('Invalid observation time');
  if (c.validFrom && Date.parse(c.validFrom) > now) return 'FUTURE';
  return c.validUntil && Date.parse(c.validUntil) < now ? 'STALE' : 'CURRENT';
}
export function usable(c: KnowledgeClaim, consumer: 'evaluation' | 'narration' | 'questionGeneration'): boolean {
  return c.usage?.[consumer] ?? consumer !== 'evaluation';
}
