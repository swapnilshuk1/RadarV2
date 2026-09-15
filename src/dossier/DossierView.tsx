import { useState, type ReactNode } from 'react';
import type { Claim, Dossier, Passage } from './contracts';
import './dossier.css';

export function DossierView({ dossier: d }: { dossier: Dossier }) {
  const [template, setTemplate] = useState<'A' | 'B'>('A');
  const [selected, setSelected] = useState<Passage | null>(null);
  const [selectedPlaneLabel, setSelectedPlaneLabel] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<'resumeNarrative' | 'linkedinStrategy' | 'screening' | 'interview'>('resumeNarrative');
  const claims = [...d.evidence.roleClaims, ...d.evidence.candidateClaims, ...d.evidence.contextualClaims, ...d.evidence.relationalClaims];
  const renderPassage = (p: Passage, i: number) => <div className="dossier-passage" key={`${i}-${p.text}`}>
    <p>{p.text} <button className={`dossier-cue ${p.state.toLowerCase()}`} onClick={() => setSelected(p)} aria-label={`Show evidence: ${p.text}`} title={`${p.kind === 'QUESTION' ? 'Open question' : p.state === 'EXPLICIT' ? 'Explicit in source' : 'Grounded inference'} · View provenance`}>{p.state === 'EXPLICIT' ? 'E' : 'I'}</button></p>
  </div>;
  const list = (items: Passage[]) => <>{items.map(renderPassage)}</>;
  const group = (title: string, items: Passage[]) => items.length ? <div className="dossier-group"><h3>{title}</h3>{list(items)}</div> : null;
  const chapter = (number: string, label: string, title: string, children: ReactNode) => <section className="dossier-chapter">
    <aside><span className="dossier-roman">{number}</span><span className="label-mono">{label}</span></aside>
    <div><h2>{title}</h2>{children}</div>
  </section>;
  const mandate = <>{group('Immediate · establish the foundations', d.mandate.immediate)}{group('Near term · prove the operating model', d.mandate.nearTerm)}{group('Medium term · build repeatability', d.mandate.mediumTerm)}{group('Outcomes that matter', d.mandate.outcomes)}</>;
  const fit = <>{group('Direct precedent', d.fit.direct)}{group('Adjacent experience', d.fit.adjacent)}{group('Transferable strengths', d.fit.transferable)}{group('Gaps and screening barriers', d.fit.gaps)}</>;
  const hinges = <div className="dossier-columns">{group('Stronger pursue if', d.decisionHinges.strongerPursueIf)}{group('Weaker if', d.decisionHinges.weakerIf)}{group('Pass if', d.decisionHinges.passIf)}</div>;
  const resolutionProvenance = (claimIds: string[]) => {
    const planes = new Set(claimIds.map(id => claims.find(claim => claim.id === id)?.plane).filter(Boolean));
    if (planes.has('RELATIONAL') || (planes.has('JD') && planes.has('CANDIDATE'))) return { sourcePlane: 'RELATIONAL' as const, label: 'ROLE + CANDIDATE' };
    if (planes.has('JD') && planes.has('CONTEXT')) return { sourcePlane: 'CONTEXT' as const, label: 'ROLE + CONTEXT' };
    if (planes.has('CONTEXT')) return { sourcePlane: 'CONTEXT' as const, label: 'CONTEXT' };
    if (planes.has('CANDIDATE')) return { sourcePlane: 'CANDIDATE' as const, label: 'CANDIDATE' };
    return { sourcePlane: 'JD' as const, label: 'ROLE' };
  };
  const selectResolution = (r: typeof d.resolutions[number]) => {
    const provenance = resolutionProvenance(r.claimIds);
    setSelectedPlaneLabel(provenance.label);
    setSelected({ text: r.consequence, state: r.status === 'RESOLVED' ? 'EXPLICIT' : 'INFERRED', kind: r.status === 'OPEN' ? 'QUESTION' : 'CONCLUSION', confidence: 0, sourcePlane: provenance.sourcePlane, evidenceRefs: r.claimIds, reasoning: r.consequence });
  };
  const scope = <dl className="dossier-scope">{d.resolutions.filter(r => ['reportingLine','executiveDistance','leadershipMode','teamScale','functionState','geography','commercialScope','compensation'].includes(r.field)).map(r => <div key={r.field}><dt>{fieldLabels[r.field]}</dt><dd>{r.status === 'OPEN' ? r.question : Array.isArray(r.value) ? r.value.join('-') : String(r.value)} <button className="dossier-cue" onClick={() => selectResolution(r)}>{r.status === 'OPEN' ? '?' : r.status === 'INFERRED' ? 'I' : 'E'}</button></dd></div>)}</dl>;

  const strategy = <>{group('Approach', d.conversationStrategy.approach)}{group('Opening the conversation', d.conversationStrategy.opening)}{group('Positioning', d.conversationStrategy.positioning)}{group('Questions worth asking', d.conversationStrategy.questions)}
    <div className="dossier-tabs" role="tablist" aria-label="Positioning workspace">{(['resumeNarrative','linkedinStrategy','screening','interview'] as const).map(key => <button role="tab" aria-selected={workspace === key} aria-controls="positioning-content" id={`tab-${key}`} key={key} onClick={() => setWorkspace(key)}>{workspaceLabels[key]}</button>)}</div>
    <div role="tabpanel" id="positioning-content" aria-labelledby={`tab-${workspace}`} className="dossier-workspace">{list(d.conversationStrategy[workspace])}</div>
  </>;
  return <article className={`dossier dossier-template-${template.toLowerCase()}`}>
    <nav className="dossier-top"><span className="dossier-brand">RADAR</span><span className="label-mono">Executive advisory · {d.candidate.name}</span>
      <div className="dossier-toggle" aria-label="Dossier template"><button aria-pressed={template === 'A'} onClick={() => setTemplate('A')}>Template A · Dossier</button><button aria-pressed={template === 'B'} onClick={() => setTemplate('B')}>Template B · Memorandum</button></div>
    </nav>
    <div className="dossier-body">
      <header className="dossier-hero">
        <div><div className="dossier-kicker"><span className={`dossier-verdict verdict-${d.verdict.verdict.toLowerCase()}`}>{d.verdict.verdict}</span><span className="label-mono">{d.verdict.screeningViability} screening viability</span><span className="label-mono">Executive decision dossier</span></div>
          <h1>{d.opportunity.title}<em>at {d.opportunity.company}</em></h1>
          <p className="dossier-identity">Prepared for {d.candidate.name} · {new Date(d.generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
          {template === 'B' && <div className="dossier-thesis"><span className="label-mono">Executive advisory thesis</span>{renderPassage(d.executiveThesis, 0)}</div>}
        </div>
        {template === 'B' && <aside className="dossier-overview"><span className="label-mono">Verdict overview · 1 minute</span><h2>{d.verdict.verdict === 'PASS' ? 'A compelling mandate. A consequential barrier.' : d.verdict.verdict === 'CONSIDER' ? 'An opportunity with a decision to resolve.' : 'A mandate worth pursuing.'}</h2>{list(d.conversationStrategy.approach)}{group('What to verify', d.watchPoints.slice(0, 1))}</aside>}
      </header>
      {template === 'A' && <section className="dossier-brief"><span className="label-mono">If you only read one thing · Executive brief</span><div className="dossier-thesis">{renderPassage(d.executiveThesis, 0)}</div><div className="dossier-columns">{group('Why it deserves a look', d.roleInterest)}{group('Watch for', d.watchPoints)}</div></section>}
      <p className="dossier-legend"><span>E</span> Explicit in a source <span>I</span> Grounded inference · Select a cue to inspect the evidence. Candidate claims are CV-reported.</p>
      {template === 'A' ? <>
        {chapter('I','Strategic career value','Why this role is interesting', list(d.strategicValue))}
        {chapter('II','Explainable reasoning','Why this recommendation?', <>{group('Identity alignment',d.recommendation.identityAlignment)}{group('Capability coverage',d.recommendation.capabilityCoverage)}{group('Career-capital value',d.recommendation.careerCapital)}</>)}
        {chapter('III','The call','The fit, and its limits',fit)}
        {chapter('IV','The mandate','What you will be expected to deliver',<>{scope}{mandate}{group('Success requirements',d.successRequirements)}</>)}
        {chapter('V','Your advantage','Where your record meets the mandate',<>{group('Relevant precedents',d.candidatePositioning.precedents)}{group('Differentiators',d.candidatePositioning.differentiators)}</>)}
        {chapter('VI','Open questions','Clarify these before committing',list(d.openQuestions))}
        {chapter('VII','Decision boundaries','What would change this decision?',hinges)}
        {chapter('VIII','Conversation strategy','How to approach the opportunity',strategy)}
      </> : <>
        {chapter('I','Why this deserves your attention','The opportunity behind the title',<>{list(d.roleInterest)}{list(d.strategicValue)}{group('Career-capital value', d.recommendation.careerCapital)}</>)}
        {chapter('II','What success requires','Build the business, own the outcome',<>{scope}{list(d.successRequirements)}{mandate}{group('Critical screening questions',d.openQuestions)}</>)}
        {chapter('III','Why this reached your desk','What travels — and what does not',<>{group('Identity alignment',d.recommendation.identityAlignment)}{group('Capability coverage',d.recommendation.capabilityCoverage)}{fit}{group('Precedents',d.candidatePositioning.precedents)}{group('Differentiators',d.candidatePositioning.differentiators)}</>)}
        {chapter('IV','Executive bottom line','The conditions that change the call',<>{group('Watch points',d.watchPoints)}{hinges}</>)}
        {chapter('V','How to win the conversation','A precise, credible approach',strategy)}
      </>}
      {chapter('IX','Supporting evidence','Evidence behind this recommendation',<>
        {group('Candidate experience & claims inventory',d.candidatePositioning.evidence)}
        {d.candidateConflicts.length > 0 && <div className="dossier-conflicts"><h3>Source differences to resolve</h3>{d.candidateConflicts.map(c => <p key={c.topic}><strong>{c.topic}</strong> — {c.question}</p>)}</div>}
        <details className="dossier-appendix"><summary>Evidence, context acquisition & claim lineage</summary>
          <h3>Decision requirements</h3>{d.verdict.requirements.map((r,i) => <div className="dossier-ledger-row" key={i}><strong>{r.requirement}</strong><span>{r.decisionRole.replaceAll('_',' ').toLowerCase()} · {r.status.replaceAll('_',' ').toLowerCase()}</span><p>{r.reasoning}</p></div>)}
          <h3>Company context: resolved and open</h3>{d.resolutions.filter(r => !Object.keys(fieldLabels).includes(r.field)).map(r => <div className="dossier-ledger-row" key={r.field}><strong>{r.field.replace(/([A-Z])/g,' $1')}</strong><p>{r.status === 'OPEN' ? r.question : Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}</p><p>{r.consequence}</p></div>)}
          <h3>Claim ledger</h3>{claims.map(c => <details key={c.id} className="dossier-ledger-row"><summary>{c.text} <span>{c.state === 'EXPLICIT' ? 'Explicit' : 'Inferred'}</span></summary><ClaimEvidence claim={c} claims={claims} sources={d.evidence.lineage}/></details>)}
          <h3>Acquisition record</h3>{d.acquisition.map((a,i) => <p key={i}>{a.field}: {a.detail}</p>)}
          <h3>Narrative approach</h3><p>{d.narrativePlan.argument}</p><p>{d.narrativePlan.emphasis.join(' · ')}</p>
          <p className="dossier-muted">Source fingerprint: {d.generation.sourceFingerprint}. Generated with {d.generation.model}. Exact-quote and lineage checks protect traceability; inference remains an analytical judgment.</p>
        </details>
      </>)}
      <footer className="dossier-footer"><span className="dossier-brand">RADAR</span><span className="label-mono">A considered decision. An evidence-led next step.</span></footer>
    </div>
    {selected && <div className="dossier-modal-backdrop" onClick={() => { setSelected(null); setSelectedPlaneLabel(null); }}><section role="dialog" aria-modal="true" aria-labelledby="evidence-title" className="dossier-evidence-dialog" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelected(null); }}>
      <button autoFocus className="dossier-close" onClick={() => { setSelected(null); setSelectedPlaneLabel(null); }}>Close evidence ×</button><h2 id="evidence-title">Behind the conclusion</h2><p>{selected.text}</p><p className="label-mono">{selected.kind === 'QUESTION' ? 'Open question' : selected.state} · {selectedPlaneLabel || selected.sourcePlane}</p>{selected.reasoning && <p><strong>Reasoning</strong> — {selected.reasoning}</p>}{selected.validationQuestion && <p><strong>Validate</strong> — {selected.validationQuestion}</p>}
      {selected.evidenceRefs.map(id => { const claim = claims.find(c => c.id === id); return claim && <ClaimEvidence key={id} claim={claim} claims={claims} sources={d.evidence.lineage}/>; })}
    </section></div>}
  </article>;
}

function ClaimEvidence({ claim, claims, sources, visited = new Set<string>() }: { claim: Claim; claims: Claim[]; sources: Dossier['evidence']['lineage']; visited?: Set<string> }) {
  if (visited.has(claim.id)) return null;
  const next = new Set(visited).add(claim.id);
  return <div className="dossier-source"><h3>{claim.text}</h3><p className="dossier-muted">{claim.state} · {Math.round(claim.confidence*100)}% analyst confidence</p>{claim.reasoning && <p>{claim.reasoning}</p>}{claim.citations.map((ref,i) => { const source = sources.find(s => s.id === ref.sourceId)!; return <div key={i}><blockquote>{ref.quote}</blockquote><p className="dossier-source-name">{source.title} · {source.attribution.replaceAll('_',' ').toLowerCase()}</p>{source.locator.startsWith('https://') ? <a href={source.locator} target="_blank" rel="noreferrer">Open source ↗</a> : <p className="dossier-source-path">{source.locator}</p>}</div>; })}{claim.derivedFrom.map(id => { const parent = claims.find(c => c.id === id); return parent && <ClaimEvidence key={id} claim={parent} claims={claims} sources={sources} visited={next}/>; })}</div>;
}
const workspaceLabels = { resumeNarrative: 'Resume narrative', linkedinStrategy: 'LinkedIn strategy', screening: 'Screening call', interview: 'Interview strategy' };
const fieldLabels: Record<string,string> = { reportingLine:'Reporting line', executiveDistance:'Executive distance', leadershipMode:'Leadership topology', teamScale:'Team scale', functionState:'Function state', geography:'Geography', commercialScope:'Commercial accountability', compensation:'Economics' };
