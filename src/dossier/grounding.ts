import { claimSchema, compositionSchema, contextFields, researchSchema, scopeFields, type Claim, type Composition, type EvidenceSource, type Passage, type Research } from './contracts';

export function validateClaims(value: unknown, sources: EvidenceSource[]): Claim[] {
  const parsed = claimSchema.array().parse(value);
  const sourceById = new Map(sources.map(s => [s.id, s]));
  if (sourceById.size !== sources.length) throw new Error('Duplicate source identity');
  const claims = new Map(parsed.map(c => [c.id, c]));
  if (claims.size !== parsed.length) throw new Error('Duplicate claim identity');
  const visit = (claim: Claim, visiting = new Set<string>()): Set<string> => {
    if (visiting.has(claim.id)) throw new Error(`Cyclic lineage: ${claim.id}`);
    const next = new Set(visiting).add(claim.id);
    const planes = new Set<string>();
    for (const ref of claim.citations) {
      const source = sourceById.get(ref.sourceId);
      if (!source || !source.text.includes(ref.quote)) throw new Error(`Unresolved exact quote: ${claim.id}/${ref.sourceId}`);
      planes.add(source.plane);
    }
    for (const id of claim.derivedFrom) {
      const parent = claims.get(id);
      if (!parent) throw new Error(`Missing parent: ${id}`);
      visit(parent, next).forEach(p => planes.add(p));
      if (claim.state === 'EXPLICIT' && parent.state === 'INFERRED') throw new Error(`Inference promoted to explicit: ${claim.id}`);
    }
    if (!planes.size) throw new Error(`Ungrounded claim: ${claim.id}`);
    if (claim.state === 'INFERRED' && !claim.reasoning?.trim()) throw new Error(`Inference needs reasoning: ${claim.id}`);
    if (claim.state === 'EXPLICIT' && !claim.citations.length) throw new Error(`Explicit claim needs source quote: ${claim.id}`);
    if (claim.plane === 'CANDIDATE' && [...planes].some(p => p !== 'CANDIDATE')) throw new Error(`Candidate claim contaminated: ${claim.id}`);
    if (claim.plane === 'JD' && [...planes].some(p => p !== 'JD' && !(claim.state === 'INFERRED' && p === 'CONTEXT'))) throw new Error(`Role claim contaminated: ${claim.id}`);
    if (claim.plane === 'CONTEXT' && [...planes].some(p => p !== 'CONTEXT' && !(claim.state === 'INFERRED' && p === 'JD'))) throw new Error(`Context claim contaminated: ${claim.id}`);
    if (claim.plane === 'RELATIONAL' && (!planes.has('JD') || !planes.has('CANDIDATE') || claim.state !== 'INFERRED')) throw new Error(`Relational claim needs role and candidate evidence: ${claim.id}`);
    return planes;
  };
  parsed.forEach(c => visit(c));
  return parsed;
}

export function validateResearch(value: unknown, sources: EvidenceSource[]): Research {
  const research = researchSchema.parse(value);
  validateClaims(research.claims, sources);
  const sourceById = new Map(sources.map(s => [s.id, s]));
  const claims = new Map(research.claims.map(c => [c.id, c]));
  const resolveId = (id: string) => {
    if (claims.has(id)) return id;
    const alt1 = id.replace(/-(?:claim-)?(\d+)$/, '-$1');
    if (claims.has(alt1)) return alt1;
    const alt2 = id.replace(/-(\d+)$/, '-claim-$1');
    if (claims.has(alt2)) return alt2;
    return id;
  };
  research.claims.forEach(c => { c.derivedFrom = c.derivedFrom.map(resolveId); });
  const refs = (ids: string[]) => ids.forEach(id => { if (!claims.has(id)) throw new Error(`Unknown claim reference: ${id}`); });
  research.resolutions.forEach(r => {
    r.claimIds = r.claimIds.map(resolveId).filter(id => claims.has(id));
    if (r.status === 'OPEN' && (!r.question || r.value !== null)) throw new Error(`Open field must become a question: ${r.field}`);
    if (r.status !== 'OPEN' && (r.value === null || !r.claimIds.length)) throw new Error(`Resolved field needs evidence: ${r.field}`);
    if (r.status === 'RESOLVED' && r.claimIds.some(id => claims.get(id)!.state === 'INFERRED')) {
      r.status = 'INFERRED';
    }
    if (r.field === 'executiveDistance' && r.status === 'RESOLVED') throw new Error('Executive distance is an analytical derivation; label INFERRED and explain the organizational position');
    if (r.field === 'teamScale' && r.status === 'RESOLVED' && r.value !== null) {
      const valueNumbers = String(r.value).match(/\d+/g) ?? [];
      const evidenceNumbers = r.claimIds.flatMap(id => claims.get(id)!.citations.flatMap(c => c.quote.match(/\d+/g) ?? []));
      if(valueNumbers.some(number=>!evidenceNumbers.includes(number))) throw new Error('Preserve the exact explicit team target; do not round it to an estimated band');
    }
  });
  for (const field of [...contextFields, ...scopeFields]) {
    if (research.resolutions.filter(r => r.field === field).length !== 1) throw new Error(`Resolve field exactly once: ${field}`);
  }
  for (const conflict of research.candidateConflicts) {
    conflict.sourceIds = conflict.sourceIds.map(id => {
      if (sourceById.get(id)?.plane === 'CANDIDATE') return id;
      const claim = claims.get(id);
      if (claim?.plane === 'CANDIDATE' && claim.citations[0]) return claim.citations[0].sourceId;
      return id;
    });
    if (conflict.sourceIds.some(id => sourceById.get(id)?.plane !== 'CANDIDATE')) throw new Error('Conflict must reference candidate sources');
  }
  research.evaluation.claimIds = research.evaluation.claimIds.map(resolveId).filter(id => claims.has(id));
  if (!research.evaluation.claimIds.length) throw new Error('Evaluation needs at least one valid claim reference');
  research.narrativePlan.claimIds = research.narrativePlan.claimIds.map(resolveId).filter(id => claims.has(id));
  if (!research.narrativePlan.claimIds.length) throw new Error('Narrative plan needs at least one valid claim reference');
  research.evaluation.requirements.forEach(r => {
    r.roleClaimIds = r.roleClaimIds.map(resolveId).flatMap(id => {
      const c = claims.get(id);
      if (!c) return [];
      if (c.plane === 'JD') return [id];
      if (c.plane === 'RELATIONAL') return c.derivedFrom.filter(pid => claims.get(pid)?.plane === 'JD');
      return [];
    });
    r.candidateClaimIds = r.candidateClaimIds.map(resolveId).flatMap(id => {
      const c = claims.get(id);
      if (!c) return [];
      if (c.plane === 'CANDIDATE') return [id];
      if (c.plane === 'RELATIONAL') return c.derivedFrom.filter(pid => claims.get(pid)?.plane === 'CANDIDATE');
      return [];
    });
    refs(r.roleClaimIds); refs(r.candidateClaimIds);
    if (r.roleClaimIds.some(id => claims.get(id)!.plane !== 'JD') || r.candidateClaimIds.some(id => claims.get(id)!.plane !== 'CANDIDATE')) throw new Error('Requirement evidence planes crossed');
    if (['SUPPORTED', 'TRANSFERABLE'].includes(r.status) && !r.candidateClaimIds.length) throw new Error('Fit needs candidate proof');
  });
  return research;
}

export function allPassages(value: unknown): Passage[] {
  if (!value || typeof value !== 'object') return [];
  if ('evidenceRefs' in value && 'text' in value) return [value as Passage];
  return Object.values(value).flatMap(allPassages);
}

export function validateComposition(value: unknown, research: Research): Composition {
  const composition = compositionSchema.parse(value);
  validatePassages(composition, research);
  return composition;
}

export function validatePassages(composition: unknown, research: Research): void {
  const claims = new Map(research.claims.map(c => [c.id, c]));
  const resolveId = (id: string) => {
    if (claims.has(id)) return id;
    const alt1 = id.replace(/-(?:claim-)?(\d+)$/, '-$1');
    if (claims.has(alt1)) return alt1;
    const alt2 = id.replace(/-(\d+)$/, '-claim-$1');
    if (claims.has(alt2)) return alt2;
    return id;
  };
  for (const p of allPassages(composition)) {
    p.evidenceRefs = p.evidenceRefs.map(resolveId);
    if (p.evidenceRefs.some(id => !claims.has(id))) throw new Error('Narrative cites unknown claim');
    if (p.state === 'EXPLICIT' && (p.kind !== 'CONCLUSION' || p.evidenceRefs.some(id => claims.get(id)!.state === 'INFERRED'))) throw new Error('Advice, questions and inference cannot become explicit fact');
    if (p.state === 'INFERRED' && !p.reasoning?.trim()) throw new Error('Narrative inference needs reasoning');

    const cited = p.evidenceRefs.map(id => claims.get(id)!);
    const hasJd = cited.some(c => c.plane === 'JD');
    const hasCandidate = cited.some(c => c.plane === 'CANDIDATE');
    const hasRelational = cited.some(c => c.plane === 'RELATIONAL');
    const hasContext = cited.some(c => c.plane === 'CONTEXT');

    if (hasRelational || (hasJd && hasCandidate)) {
      p.sourcePlane = 'RELATIONAL';
    } else if (hasCandidate && !hasJd && !hasContext) {
      p.sourcePlane = 'CANDIDATE';
    } else if (hasJd && !hasCandidate && !hasContext) {
      p.sourcePlane = 'JD';
    } else if (hasContext && !hasJd && !hasCandidate) {
      p.sourcePlane = 'CONTEXT';
    }

    if (p.sourcePlane === 'CANDIDATE' && p.evidenceRefs.some(id => claims.get(id)!.plane !== 'CANDIDATE')) throw new Error('Narrative candidate evidence contaminated');
    if (p.sourcePlane === 'RELATIONAL') {
      if (!cited.some(c => c.plane === 'RELATIONAL') && !(cited.some(c => c.plane === 'JD') && cited.some(c => c.plane === 'CANDIDATE'))) throw new Error(`Personalized narrative needs both evidence planes. Passage: ${p.text}. Cited IDs: ${p.evidenceRefs.join(', ')}. Cite the actual relevant JD and candidate claims, or use CANDIDATE for a candidate-only observation, JD for a role-only observation, CONTEXT for company-only interpretation.`);
    }
  }
}
