import { claimSchema, compositionSchema, contextFields, researchSchema, scopeFields, type Claim, type Composition, type EvidenceSource, type Passage, type Research } from './contracts';

const unsupportedAbsence = /(?:\b(?:candidate|candidate's)\b.{0,80}\b(?:does not evidence|lack(?:s| of)?|does not meet|fails to meet|is ineligible)\b)|\b(?:candidate\s+)?(?:lacks?|does not have|doesn't have|has no|no verifiable track record|absence of|does not meet|doesn't meet|fails to meet|is ineligible)\b/i;
const recruiterPerspective = /\b(?:tell the recruiter|tell the employer|reject the candidate|other candidates|the hiring manager should|the employer should)\b/i;

function assertEvidenceBoundCandidateLanguage(text: string, label: string) {
  if (unsupportedAbsence.test(text) && !/\bnot (?:directly )?evidenced\b|\bnot established in (?:the )?(?:supplied )?(?:candidate sources|CVs?|resumes?)\b|\bthe (?:supplied )?(?:CVs?|resumes?) do not demonstrate\b|\b(?:lacks?|has no) (?:direct|documented|demonstrable|verifiable|supplied) (?:evidence|proof)\b|\b(?:does not provide|lack of) explicit (?:and )?(?:verifiable )?(?:experience|evidence)\b|\bno verifiable track record (?:in|from|within) (?:the )?(?:supplied )?(?:candidate sources|CVs?|resumes?)\b/i.test(text)) {
    throw new Error(`${label} turns missing candidate evidence into a claim of absence: ${text}`);
  }
}

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
    if (claim.state === 'INFERRED' && claim.citations.length) throw new Error(`Inference must derive from validated claims, not carry source quotations: ${claim.id}`);
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
  const claims = new Map(research.claims.map(c => [c.id, c]));
  if (claims.size !== research.claims.length) throw new Error('Duplicate claim identity');
  const resolveId = (id: string) => {
    if (claims.has(id)) return id;
    const alt1 = id.replace(/-(?:claim-)?(\d+)$/, '-$1');
    if (claims.has(alt1)) return alt1;
    const alt2 = id.replace(/-(\d+)$/, '-claim-$1');
    if (claims.has(alt2)) return alt2;
    throw new Error(`Unknown claim reference: ${id}`);
  };
  const resolveIds = (ids: string[]) => ids.map(resolveId);
  research.claims.forEach(c => { c.derivedFrom = resolveIds(c.derivedFrom); });
  validateClaims(research.claims, sources);
  const sourceById = new Map(sources.map(s => [s.id, s]));

  research.resolutions.forEach(r => {
    r.claimIds = resolveIds(r.claimIds);
    if (r.status === 'OPEN' && (!r.question || r.value !== null)) throw new Error(`Open field must become a question: ${r.field}`);
    if (r.status !== 'OPEN' && (r.value === null || !r.claimIds.length)) throw new Error(`Resolved field needs evidence: ${r.field}`);
    if (r.status === 'RESOLVED' && r.claimIds.some(id => claims.get(id)!.state === 'INFERRED')) r.status = 'INFERRED';
    if (r.field === 'executiveDistance' && r.status === 'RESOLVED') throw new Error('Executive distance is an analytical derivation; label INFERRED and explain the organizational position');
    if (r.field === 'executiveDistance' && r.value === 0) {
      const support = r.claimIds.map(id => claims.get(id)!.text).join(' ');
      if (!/\b(?:CEO|chief executive|company head|enterprise head|managing director)\b/i.test(support)) throw new Error('Executive distance 0 is reserved for the company or enterprise head');
    }
    if (r.field === 'executiveDistance' && r.value === 0 && /\breports? to (?:the )?board\b/i.test(r.claimIds.map(id => claims.get(id)!.text).join(' '))) throw new Error('A vertical leader reporting to the Board is executive-distance 1, not company head');
    if (['leadershipMode', 'functionState'].includes(r.field) && r.status === 'RESOLVED') {
      const labels = r.field === 'leadershipMode' ? /\b(?:DIRECT|MATRIX|HYBRID)\b/i : /\b(?:ESTABLISHED|SCALE-UP|GREENFIELD|RESTRUCTURE)\b/i;
      const quotes = r.claimIds.flatMap(id => claims.get(id)!.citations.map(c => c.quote)).join(' ');
      if (!labels.test(quotes)) throw new Error(`${r.field} is an analytical classification; label it INFERRED unless the source uses the classification itself`);
    }
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
      const claim = claims.get(resolveId(id));
      if (claim?.plane === 'CANDIDATE' && claim.citations[0]) return claim.citations[0].sourceId;
      throw new Error(`Candidate conflict references a non-candidate source: ${id}`);
    });
    if (conflict.sourceIds.some(id => sourceById.get(id)?.plane !== 'CANDIDATE')) throw new Error('Conflict must reference candidate sources');
  }
  research.evaluation.claimIds = resolveIds(research.evaluation.claimIds);
  if (!research.evaluation.claimIds.length) throw new Error('Evaluation needs at least one valid claim reference');
  research.narrativePlan.claimIds = resolveIds(research.narrativePlan.claimIds);
  if (!research.narrativePlan.claimIds.length) throw new Error('Narrative plan needs at least one valid claim reference');
  const projectRequirementRefs = (ids: string[], plane: 'JD' | 'CANDIDATE', label: string) => ids.flatMap(rawId => {
    const id = resolveId(rawId);
    const claim = claims.get(id)!;
    if (claim.plane === plane) return [id];
    if (claim.plane !== 'RELATIONAL') throw new Error(`${label} must reference ${plane} or relational evidence: ${rawId}`);
    const parents = claim.derivedFrom.filter(parentId => claims.get(parentId)?.plane === plane);
    if (!parents.length) throw new Error(`${label} relational evidence has no ${plane} lineage: ${rawId}`);
    return parents;
  });
  research.evaluation.requirements.forEach(r => {
    r.roleClaimIds = projectRequirementRefs(r.roleClaimIds, 'JD', `Requirement '${r.requirement}' role evidence`);
    r.candidateClaimIds = projectRequirementRefs(r.candidateClaimIds, 'CANDIDATE', `Requirement '${r.requirement}' candidate evidence`);
    if (r.roleClaimIds.some(id => claims.get(id)!.plane !== 'JD') || r.candidateClaimIds.some(id => claims.get(id)!.plane !== 'CANDIDATE')) throw new Error('Requirement evidence planes crossed');
    if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(r.status) && !r.candidateClaimIds.length) throw new Error('Fit classification needs candidate proof');
    if (r.decisionRole === 'HARD_SCREEN' && !r.mandatory) throw new Error('A hard screen must be mandatory');
    if (r.decisionRole === 'HARD_SCREEN') {
      const entryText = r.roleClaimIds.map(id => claims.get(id)!.text).join(' ');
      if (!/\b(?:required|must have|minimum|eligib(?:le|ility)|qualification|prior experience|relevant experience|years? of experience|proven track record|portfolio)\b/i.test(entryText)) throw new Error('A hard screen needs an explicit employer entry qualification');
      if (/\b(?:compensation|salary|ctc|pay|on[- ]?site|remote|hybrid|location|relocat)\b/i.test(r.requirement)) throw new Error('Employment conditions are not candidate-evidence hard screens');
    }
    if (r.decisionRole === 'PREFERENCE' && r.mandatory) throw new Error('A preference cannot be mandatory');
    assertEvidenceBoundCandidateLanguage(r.reasoning, `Requirement '${r.requirement}'`);
  });
  const hardScreens = research.evaluation.requirements.filter(r => r.decisionRole === 'HARD_SCREEN');
  const hardBarrier = hardScreens.some(r => ['NOT_EVIDENCED', 'CONTRADICTED'].includes(r.status));
  if (research.evaluation.screeningViability === 'STRONG' && hardBarrier) throw new Error('Strong screening viability cannot contain an unsupported or contradicted hard screen');
  if (research.evaluation.screeningViability === 'BLOCKED' && !hardBarrier) throw new Error('Blocked screening viability needs a real hard-screen barrier');
  assertEvidenceBoundCandidateLanguage(research.evaluation.rationale, 'Verdict rationale');
  assertEvidenceBoundCandidateLanguage(research.narrativePlan.argument, 'Narrative plan');
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
  const screeningTerms = /\b(?:hard screen|screening blocker|screening criterion|employer[- ]entry|eligibility (?:requirement|criterion|bundle)|(?:employer|role|documented|mandatory)\s+(?:side\s+)?eligibility)\b/i;
  const candidateConditions = /\b(?:compensation|salary|pay|work model|on[- ]?site|remote|hybrid|location|authority level|organizational altitude|scope|willingness)\b/i;
  const hardScreenRoleClaims = new Set(research.evaluation.requirements.filter(r => r.decisionRole === 'HARD_SCREEN').flatMap(r => r.roleClaimIds));
  const resolveId = (id: string) => {
    if (claims.has(id)) return id;
    const alt1 = id.replace(/-(?:claim-)?(\d+)$/, '-$1');
    if (claims.has(alt1)) return alt1;
    const alt2 = id.replace(/-(\d+)$/, '-claim-$1');
    if (claims.has(alt2)) return alt2;
    return id;
  };
  for (const p of allPassages(composition)) {
    assertEvidenceBoundCandidateLanguage(p.text, 'Dossier passage');
    if (screeningTerms.test(p.text) && candidateConditions.test(p.text)) throw new Error('Candidate-side conditions cannot be described as employer screening criteria');
    if (recruiterPerspective.test(p.text)) throw new Error('Dossier prose must remain the candidate\'s executive adviser');
    p.evidenceRefs = p.evidenceRefs.map(resolveId);
    if (p.evidenceRefs.some(id => !claims.has(id))) throw new Error('Narrative cites unknown claim');
    if (screeningTerms.test(p.text) && !p.evidenceRefs.some(id => hardScreenRoleClaims.has(id))) throw new Error('Employer screening terminology needs actual hard-screen evidence');
    if (p.state === 'EXPLICIT' && (p.kind !== 'CONCLUSION' || p.evidenceRefs.some(id => claims.get(id)!.state === 'INFERRED'))) throw new Error('Advice, questions and inference cannot become explicit fact');
    if (p.state === 'INFERRED' && !p.reasoning?.trim()) throw new Error('Narrative inference needs reasoning');

    const cited = p.evidenceRefs.map(id => claims.get(id)!);
    const hasJd = cited.some(c => c.plane === 'JD');
    const hasCandidate = cited.some(c => c.plane === 'CANDIDATE');
    const hasRelational = cited.some(c => c.plane === 'RELATIONAL');
    const hasContext = cited.some(c => c.plane === 'CONTEXT');

    if (hasRelational || (hasJd && hasCandidate)) {
      p.sourcePlane = 'RELATIONAL';
    } else if (hasContext && hasJd && !hasCandidate) {
      p.sourcePlane = 'CONTEXT';
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
  const passages = allPassages(composition);
  const normalized = new Map<string, number>();
  for (const passage of passages) {
    const key = passage.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    const count = (normalized.get(key) ?? 0) + 1;
    normalized.set(key, count);
    if (count > 1) throw new Error('Dossier repeats a passage instead of allocating distinct editorial work to each section');
  }
}
