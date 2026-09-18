import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDossier, extractValidatedSourceClaims, researchModelInput, sourceFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';
import { validateComposition, validateResearch, validateClaims, validatePassages } from '../../src/dossier/grounding';
import { contextFields, scopeFields, type Composition, type EvidenceSource, type Passage, type Research } from '../../src/dossier/contracts';
import { CompanyWebsiteProvider } from '../../src/dossier/context';
import { readSliceInput } from '../../scripts/dossier/source-input';
import { modelSchema } from '../../src/dossier/model-schema';
import { researchSchema } from '../../src/dossier/contracts';
import { GeminiJsonModel } from '../../src/lib/model/json-model';
import { resolveSourceClaims, sourceSpans } from '../../src/dossier/source-spans';

const sources: EvidenceSource[] = [
  { id:'jd',plane:'JD',title:'Raw job',locator:'job:1',text:'Build a new sales team. Ten years of property sales required.',capturedAt:'2026-09-15T00:00:00.000Z',attribution:'JOB_POST' },
  { id:'cv',plane:'CANDIDATE',title:'CV',locator:'candidate:1',text:'Built a 40-person marketing team.',capturedAt:'2026-09-15T00:00:00.000Z',attribution:'CANDIDATE_SUPPLIED' },
];
function research(): Research {
  return {
    claims:[
      {id:'jd-role',text:'A new sales team is required.',state:'EXPLICIT',confidence:1,plane:'JD',citations:[{sourceId:'jd',quote:'Build a new sales team.'}],derivedFrom:[]},
      {id:'cv-candidate',text:'The CV reports building a 40-person marketing team.',state:'EXPLICIT',confidence:1,plane:'CANDIDATE',citations:[{sourceId:'cv',quote:'Built a 40-person marketing team.'}],derivedFrom:[]},
      {id:'relation',text:'Team-building transfers; property-sales experience is not established.',state:'INFERRED',confidence:0.8,plane:'RELATIONAL',citations:[],derivedFrom:['jd-role','cv-candidate'],reasoning:'Both involve team building, but marketing is a different domain.'},
    ],
    resolutions:[...contextFields,...scopeFields].map(field => ({field,status:'OPEN',value:null,claimIds:[],methods:['ask'],question:`What is the ${field}?`,consequence:'Determine the actual scope before committing.'})),
    candidateConflicts:[],
    evaluation:{verdict:'CONSIDER',screeningViability:'PLAUSIBLE',rationale:'Verify domain eligibility.',claimIds:['relation'],requirements:[{requirement:'Team building',mandatory:true,decisionRole:'CORE_CAPABILITY',status:'TRANSFERABLE',roleClaimIds:['jd-role'],candidateClaimIds:['cv-candidate'],reasoning:'Marketing team-building precedent transfers.'}]},
    narrativePlan:{roleArchetype:'Builder',mandateShape:'Build',careerMove:'Domain stretch',authorityShape:'Unresolved',fitShape:'Transferability-heavy',evidenceShape:'Domain gap',decisionTension:'Eligibility',companyTrajectory:'Unresolved',argument:'Lead with the domain stretch before team-building proof.',emphasis:['Eligibility'],sectionOrder:['fit','mandate'],claimIds:['relation']},
  };
}
function composition(): Composition {
  const p: Passage = {text:'Use the team-building precedent to explore the mandate, while verifying domain eligibility.',kind:'ADVICE',state:'INFERRED',confidence:0.8,sourcePlane:'RELATIONAL',evidenceRefs:['relation'],reasoning:'The candidate has adjacent team-building experience.'};
  let serial = 0;
  const distinct = () => ({...p,text:`${p.text} Distinct editorial purpose ${++serial}.`});
  const groups = (keys: string[]) => Object.fromEntries(keys.map(k => [k,[distinct()]]));
  return {executiveThesis:distinct(),roleInterest:[distinct()],strategicValue:[distinct()],recommendation:groups(['identityAlignment','capabilityCoverage','careerCapital']),fit:groups(['direct','adjacent','transferable','gaps']),mandate:groups(['immediate','nearTerm','mediumTerm','outcomes']),successRequirements:[distinct()],candidatePositioning:groups(['precedents','differentiators','evidence']),openQuestions:[distinct()],watchPoints:[distinct()],decisionHinges:groups(['strongerPursueIf','weakerIf','passIf']),conversationStrategy:groups(['approach','opening','questions','positioning','screening','interview','resumeNarrative','linkedinStrategy'])} as Composition;
}

describe('Dossier evidence and field resolution', () => {
  it('keeps executive distance inferred and preserves explicit team numbers', () => {
    const value=research();
    const distance=value.resolutions.find(r=>r.field==='executiveDistance')!;
    Object.assign(distance,{status:'RESOLVED',value:0,claimIds:['jd-role']});
    expect(()=>validateResearch(value,sources)).toThrow('Executive distance is an analytical derivation');
    Object.assign(distance,{status:'OPEN',value:null,claimIds:[]});
    const team=value.resolutions.find(r=>r.field==='teamScale')!;
    Object.assign(team,{status:'RESOLVED',value:'5–15',claimIds:['jd-role']});
    expect(()=>validateResearch(value,sources)).toThrow('Preserve the exact explicit team target');
  });
  it('rejects an enterprise-head distance for a non-enterprise role and literalizes analytic classifications', () => {
    const value=research();
    const distance=value.resolutions.find(r=>r.field==='executiveDistance')!;
    Object.assign(distance,{status:'INFERRED',value:0,claimIds:['jd-role'],methods:['infer']});
    expect(()=>validateResearch(value,sources)).toThrow('Executive distance 0');
    Object.assign(distance,{status:'OPEN',value:null,claimIds:[],methods:['ask']});
    const topology=value.resolutions.find(r=>r.field==='leadershipMode')!;
    Object.assign(topology,{status:'RESOLVED',value:'DIRECT',claimIds:['jd-role'],methods:['extract']});
    expect(()=>validateResearch(value,sources)).toThrow('leadershipMode is an analytical classification');
  });
  it('resolves numbered passages to original text without rewriting CRLF or punctuation', () => {
    const source={...sources[1],text:'Built a 40-person team.\r\nRevenue contribution rose from 3% to 32%.'};
    const spans=sourceSpans(source);
    expect(spans.map(s=>source.text.slice(s.start,s.end))).toEqual(spans.map(s=>s.text));
    const claim=research().claims[1];
    expect(resolveSourceClaims({claims:[{...claim,citations:[{sourceId:'cv',spanId:'s1'}]}]},[source])[0].citations[0].quote).toBe('Revenue contribution rose from 3% to 32%.');
    expect(()=>resolveSourceClaims({claims:[{...claim,citations:[{sourceId:'cv',spanId:'missing'}]}]},[source])).toThrow('Unknown source passage');
  });
  it('keeps minified JD qualifications local and permits contiguous multi-span evidence', () => {
    const minified={...sources[0],id:'jd-minified',text:`Role overview ${'hands-on delivery across complex stakeholder groups '.repeat(12)}; Relevant experience in regulated product operations is required; ${'cross-functional execution across priority programs '.repeat(12)}; This is an individual contributor role leading through craft and judgment rather than headcount; ${'customer outcomes and operating rhythm '.repeat(8)}`};
    const spans=sourceSpans(minified);
    expect(spans.every(span => span.text === minified.text.slice(span.start,span.end))).toBe(true);
    const qualificationSpan=spans.find(span => span.text.includes('Relevant experience in regulated product operations is required'))!;
    const operatingShapeSpan=spans.find(span => span.text.includes('individual contributor role leading through craft'))!;
    expect(qualificationSpan.id).not.toBe(operatingShapeSpan.id);
    const multiSpanClaim={...research().claims[0],id:'JD-1-1',citations:[{sourceId:'jd-minified',spanId:qualificationSpan.id},{sourceId:'jd-minified',spanId:spans[spans.indexOf(qualificationSpan)+1].id}]};
    const resolved=resolveSourceClaims({claims:[multiSpanClaim]},[minified])[0];
    expect(resolved.citations.map(citation=>citation.quote)).toEqual([qualificationSpan.text,spans[spans.indexOf(qualificationSpan)+1].text]);
    const candidate=sources[1];
    const qualified=research();
    qualified.claims[0]={...qualified.claims[0],id:'jd-qualification',text:'The role requires regulated product operations experience.',citations:[{sourceId:'jd-minified',quote:qualificationSpan.text}]};
    qualified.claims[2]={...qualified.claims[2],derivedFrom:['jd-qualification','cv-candidate']};
    qualified.evaluation.claimIds=['relation']; qualified.narrativePlan.claimIds=['relation'];
    Object.assign(qualified.evaluation.requirements[0],{requirement:'Relevant experience in regulated product operations',decisionRole:'HARD_SCREEN',mandatory:true,roleClaimIds:['jd-qualification']});
    expect(()=>validateResearch(qualified,[minified,candidate])).not.toThrow();
    const operatingShape=structuredClone(qualified);
    operatingShape.claims[0]={...operatingShape.claims[0],id:'jd-operating-shape',text:'The role is individual contributor.',citations:[{sourceId:'jd-minified',quote:operatingShapeSpan.text}]};
    operatingShape.claims[2]={...operatingShape.claims[2],derivedFrom:['jd-operating-shape','cv-candidate']};
    Object.assign(operatingShape.evaluation.requirements[0],{requirement:'Individual contributor role',roleClaimIds:['jd-operating-shape']});
    expect(()=>validateResearch(operatingShape,[minified,candidate])).toThrow('explicit employer entry qualification');
  });
  it('assigns source-scoped ordinals when the model repeats a source-claim ID', () => {
    const repeated={claims:[
      {...research().claims[1],id:'CANDIDATE-1-1',citations:[{sourceId:'cv',spanId:'s0'}]},
      {...research().claims[1],id:'CANDIDATE-1-1',citations:[{sourceId:'cv',spanId:'s0'}]},
    ]};
    expect(resolveSourceClaims(repeated,[sources[1]]).map(claim=>claim.id)).toEqual(['CANDIDATE-1-1','CANDIDATE-1-2']);
  });
  it('projects only the established research contract to the model', () => {
    const frozen={opportunity:{id:'1',company:'Example',title:'Role'},candidate:{name:'Candidate'},sources,evidence:research().claims,candidateSourceRefs:[{id:'cv',title:'CV'}],candidateConflicts:[],acquisition:[],validEvidenceClaimIds:['jd-role','cv-candidate','relation'],fields:['companySize'],fingerprint:'internal'} as FrozenResearchInput;
    const payload=researchModelInput(frozen) as Record<string,unknown>;
    expect(Object.keys(payload).sort()).toEqual(['acquisition','candidate','candidateConflicts','candidateSources','evidence','fields','opportunity','reminders','validEvidenceClaimIds']);
    expect(payload).not.toHaveProperty('sources'); expect(payload).not.toHaveProperty('fingerprint');
  });
  it('sends the runtime contract to the model with required decision consequences', () => {
    const schema=modelSchema(researchSchema) as {properties:{resolutions:{items:{required:string[]}}}};
    expect(schema.properties.resolutions.items.required).toContain('consequence');
    expect(schema.properties.resolutions.items.required).toContain('status');
  });
  it('preserves existing model transport defaults and supports a bounded dossier response schema',async()=>{
    const bodies: {generationConfig: Record<string,unknown>}[]=[];
    const request: typeof fetch=async(_url,options)=>{bodies.push(JSON.parse(options!.body as string));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}),{status:200});};
    await new GeminiJsonModel('test-project',async()=>'test-token',request).generate('instruction',{});
    await new GeminiJsonModel('test-project',async()=>'test-token',request,{maxOutputTokens:24576,temperature:0.25}).generate('instruction',{},modelSchema(researchSchema));
    expect(bodies[0].generationConfig.maxOutputTokens).toBe(8192);
    expect(bodies[0].generationConfig.temperature).toBe(0);
    expect(bodies[1].generationConfig.responseSchema).toEqual(modelSchema(researchSchema));
  });
  it('preserves grounded inference and open fields instead of dropping them', () => {
    const result = validateResearch(research(),sources);
    expect(result.claims.find(c => c.id === 'relation')?.state).toBe('INFERRED');
    expect(result.resolutions).toHaveLength(16);
  });
  it('rejects an invented quotation', () => {
    const value=research(); value.claims[0].citations[0].quote='Reports to the CEO';
    expect(() => validateResearch(value,sources)).toThrow('Unresolved exact quote');
  });
  it('prevents job requirements becoming candidate achievements', () => {
    const value=research(); value.claims[0].plane='CANDIDATE';
    expect(() => validateResearch(value,sources)).toThrow('Candidate claim contaminated');
  });
  it('permits grounded role/context synthesis without importing candidate achievements', () => {
    const value=research();
    value.claims.push({id:'context-inference',text:'The role indicates expansion.',state:'INFERRED',confidence:0.7,plane:'CONTEXT',citations:[],derivedFrom:['jd-role'],reasoning:'The new sales team in the JD indicates an expansion hypothesis.'});
    expect(validateResearch(value,sources).claims).toHaveLength(4);
    value.claims[3].derivedFrom.push('cv-candidate');
    expect(()=>validateResearch(value,sources)).toThrow('Context claim contaminated');
  });
  it('requires both evidence planes for relational reasoning', () => {
    const value=research(); value.claims[2].derivedFrom=['jd-role'];
    expect(() => validateResearch(value,sources)).toThrow('Relational claim needs');
  });
  it('grounds candidate-company comparison without inventing an unrelated JD citation', () => {
    const context:EvidenceSource={...sources[0],id:'company',plane:'CONTEXT',text:'The company is building a marketing team.'};
    const value=research();
    value.claims.push({id:'company-team',text:context.text,state:'EXPLICIT',confidence:1,plane:'CONTEXT',citations:[{sourceId:context.id,quote:context.text}],derivedFrom:[]});
    value.claims[2]={...value.claims[2],text:'Candidate team-building experience is relevant to company expansion.',derivedFrom:['cv-candidate','company-team']};
    expect(()=>validateClaims(value.claims,[...sources,context])).not.toThrow();
    const passage:Passage={text:'Use the documented team-building precedent to explore the company expansion.',kind:'ADVICE',state:'INFERRED',confidence:0.8,sourcePlane:'RELATIONAL',evidenceRefs:['cv-candidate','company-team'],reasoning:'Candidate and company evidence establish a comparable team-building situation.'};
    expect(()=>validatePassages({passage},value)).not.toThrow();
    value.claims[2].derivedFrom=['company-team'];
    expect(()=>validateClaims(value.claims,[...sources,context])).toThrow('Relational claim needs');
    value.claims[2].derivedFrom=['cv-candidate','company-team'];
    value.claims[2].plane='CANDIDATE';
    expect(()=>validateClaims(value.claims,[...sources,context])).toThrow('Candidate claim contaminated');
  });
  it('accepts an evidence-free context page without pressuring the model to invent claims', async()=>{
    let calls=0;
    const model={id:'empty-context-probe',version:'1',async generate(){calls++;return {claims:[]};}};
    const context:EvidenceSource={...sources[0],id:'empty-context',plane:'CONTEXT',text:'Loading viewer...'};
    expect(await extractValidatedSourceClaims(model,context,'CONTEXT-1-')).toEqual([]);
    expect(calls).toBe(1);
  });
  it('rejects circular derivations', () => {
    const value=research(); value.claims[2].derivedFrom.push('relation');
    expect(() => validateResearch(value,sources)).toThrow('Cyclic lineage');
  });
  it('does not promote inferred content to an explicit narrative statement', () => {
    const value=composition(); value.executiveThesis={...value.executiveThesis,state:'EXPLICIT',kind:'CONCLUSION'};
    expect(() => validateComposition(value,research())).toThrow('cannot become explicit');
  });
  it('rejects candidate-absence claims, recruiter perspective, and duplicated editorial work', () => {
    const value=composition();
    value.executiveThesis.text='The candidate lacks property-sales experience.';
    expect(()=>validateComposition(value,research())).toThrow('missing candidate evidence');
    const employer=composition(); employer.openQuestions[0].text='Tell the recruiter to reject the candidate.';
    expect(()=>validateComposition(employer,research())).toThrow('candidate\'s executive adviser');
    const duplicate=composition(); duplicate.roleInterest[0].text=duplicate.executiveThesis.text;
    expect(()=>validateComposition(duplicate,research())).toThrow('repeats a passage');
  });
  it('requires actual hard-screen evidence for employer screening terminology', () => {
    const core=composition(); core.executiveThesis={...core.executiveThesis,text:'This is an employer screening criterion.',sourcePlane:'JD',evidenceRefs:['jd-role']};
    expect(()=>validateComposition(core,research())).toThrow('actual hard-screen evidence');
    const hardResearch=research(); Object.assign(hardResearch.evaluation.requirements[0],{decisionRole:'HARD_SCREEN',mandatory:true});
    const hard=composition(); hard.executiveThesis={...hard.executiveThesis,text:'This is an employer screening criterion.',sourcePlane:'JD',evidenceRefs:['jd-role']};
    expect(()=>validateComposition(hard,hardResearch)).not.toThrow();
    const lineage=composition(); lineage.executiveThesis={...lineage.executiveThesis,text:'This is an employer screening criterion.',sourcePlane:'RELATIONAL',evidenceRefs:['relation']};
    expect(()=>validateComposition(lineage,hardResearch)).not.toThrow();
  });
  it('keeps candidate-side conditions out of employer screening language', () => {
    const value=composition();
    value.decisionHinges.passIf[0].text='The stated compensation is a hard screening criterion.';
    expect(()=>validateComposition(value,research())).toThrow('Candidate-side conditions cannot be described as employer screening criteria');
  });
  it('allows an empty child block to be omitted without manufacturing editorial filler', () => {
    const value=composition(); value.conversationStrategy.interview=[];
    expect(validateComposition(value,research()).conversationStrategy.interview).toEqual([]);
  });
  it('enforces meaningful requirement roles and screening viability', () => {
    const hardScreen=research();
    Object.assign(hardScreen.evaluation.requirements[0], { decisionRole:'HARD_SCREEN', mandatory:false });
    expect(()=>validateResearch(hardScreen,sources)).toThrow('hard screen must be mandatory');
    const qualificationSources: EvidenceSource[] = [
      { id:'jd-entry', plane:'JD', title:'JD', locator:'job:entry', text:'Relevant experience in supply-chain or logistics operations.', capturedAt:'2026-09-15T00:00:00.000Z', attribution:'JOB_POST' },
      sources[1],
    ];
    const qualification=research();
    qualification.claims[0]={...qualification.claims[0],id:'jd-entry',text:'The role asks for operating-domain background.',citations:[{sourceId:'jd-entry',quote:'Relevant experience in supply-chain or logistics operations.'}]};
    qualification.claims[2]={...qualification.claims[2],derivedFrom:['jd-entry','cv-candidate']};
    qualification.evaluation.claimIds=['relation']; qualification.narrativePlan.claimIds=['relation'];
    Object.assign(qualification.evaluation.requirements[0], { decisionRole:'HARD_SCREEN', mandatory:true, requirement:'Relevant experience in supply-chain or logistics operations', roleClaimIds:['jd-entry'] });
    expect(()=>validateResearch(qualification,qualificationSources)).not.toThrow();
    const responsibilitySources: EvidenceSource[] = [
      { id:'jd-responsibility', plane:'JD', title:'JD', locator:'job:responsibility', text:'Lead day-to-day supply-chain operations and improve delivery performance.', capturedAt:'2026-09-15T00:00:00.000Z', attribution:'JOB_POST' },
      sources[1],
    ];
    const responsibility=research();
    responsibility.claims[0]={...responsibility.claims[0],id:'jd-responsibility',text:'Lead day-to-day supply-chain operations and improve delivery performance.',citations:[{sourceId:'jd-responsibility',quote:'Lead day-to-day supply-chain operations and improve delivery performance.'}]};
    responsibility.claims[2]={...responsibility.claims[2],derivedFrom:['jd-responsibility','cv-candidate']};
    responsibility.evaluation.claimIds=['relation']; responsibility.narrativePlan.claimIds=['relation'];
    Object.assign(responsibility.evaluation.requirements[0], { decisionRole:'HARD_SCREEN', mandatory:true, requirement:'Lead day-to-day supply-chain operations and improve delivery performance', roleClaimIds:['jd-responsibility'] });
    expect(()=>validateResearch(responsibility,responsibilitySources)).toThrow('explicit employer entry qualification');
    const condition=research();
    Object.assign(condition.evaluation.requirements[0], { decisionRole:'HARD_SCREEN', mandatory:true, requirement:'Onsite work model' });
    expect(()=>validateResearch(condition,sources)).toThrow('Employment conditions');
    const preference=research();
    Object.assign(preference.evaluation.requirements[0], { decisionRole:'PREFERENCE', mandatory:true });
    expect(()=>validateResearch(preference,sources)).toThrow('preference cannot be mandatory');
    const strong=structuredClone(qualification);
    Object.assign(strong.evaluation.requirements[0], { status:'NOT_EVIDENCED' });
    strong.evaluation.screeningViability='STRONG';
    expect(()=>validateResearch(strong,qualificationSources)).toThrow('Strong screening viability');
    const blocked=research(); blocked.evaluation.screeningViability='BLOCKED';
    expect(()=>validateResearch(blocked,sources)).toThrow('Blocked screening viability');
  });
  it('fails closed on unknown or wrong-plane research references', () => {
    const unknown=research(); unknown.evaluation.claimIds=['missing'];
    expect(()=>validateResearch(unknown,sources)).toThrow('Unknown claim reference');
    const wrongPlane=research(); wrongPlane.evaluation.requirements[0].roleClaimIds=['cv-candidate'];
    expect(()=>validateResearch(wrongPlane,sources)).toThrow('must reference JD');
  });
  it('uses stable source identity when retrieval timestamps differ', () => {
    const later=sources.map(source=>({...source,capturedAt:'2026-10-15T00:00:00.000Z'}));
    expect(sourceFingerprint(sources)).toBe(sourceFingerprint(later));
  });
  it('retains candidate conflicts as unresolved source differences', () => {
    const value=research(); value.candidateConflicts=[{topic:'Employment dates',sourceIds:['cv','cv2'],question:'Which end date is correct?'}];
    expect(validateResearch(value,[...sources,{...sources[1],id:'cv2',text:'Employment ended in June.'}]).candidateConflicts).toEqual(value.candidateConflicts);
  });
  it('calls acquisition, then research/planning, then prose against the same research', async () => {
    const requests: unknown[]=[];
    const stages: string[]=[];
    let proseCall=0;
    const r=research();
    r.claims=[
      {...r.claims[0],id:'JD-1-1'},
      {...r.claims[1],id:'CANDIDATE-1-1'},
      {...r.claims[2],derivedFrom:['JD-1-1','CANDIDATE-1-1']},
    ];
    r.evaluation.requirements[0].roleClaimIds=['JD-1-1']; r.evaluation.requirements[0].candidateClaimIds=['CANDIDATE-1-1'];
    const output = await buildDossier({opportunity:{id:'1',company:'Example',title:'Sales Head'},candidate:{name:'Candidate'},sources},[{id:'test',async acquire(){stages.push('acquire');return {sources:[],attempts:[]};}}],{id:'test',version:'test',async generate(_instruction,input){
      requests.push(input);
      const request=input as {plane?:string; evidence?:unknown};
      if(request.plane) return {claims:r.claims.filter(c=>c.plane===request.plane).map(c=>({...c,citations:c.citations.map(ref=>({sourceId:ref.sourceId,spanId:'s0'}))}))};
      if(request.evidence) return {...r, claims:[r.claims[2]]};
      return JSON.parse(JSON.stringify(composition()).replaceAll('relation', 'INFERRED-1').replaceAll('Distinct editorial purpose', `Distinct editorial purpose ${++proseCall}`));
    }},s=>stages.push(s));
    expect(requests.length).toBeGreaterThan(4);
    expect((requests[3] as {research:Research}).research.narrativePlan.argument).toContain('domain stretch');
    expect(output.conversationStrategy.linkedinStrategy).toHaveLength(1);
    expect(output.evidence.relationalClaims[0].id).toBe('INFERRED-1');
    expect(output.evidence.relationalClaims[0].id).not.toBe('relation');
    expect(output.evidence.lineage).toEqual(sources);
    expect(stages.indexOf('acquire')).toBeLessThan(stages.findIndex(s=>s.includes('Reasoning')));
  });
  it('failed context acquisition remains an acquisition attempt, not a negative company fact',async()=>{
    const provider=new CompanyWebsiteProvider([{url:'https://example.com/',title:'Company'}],async()=>new Response('',{status:503}));
    const result=await provider.acquire({id:'1',company:'Example',title:'Role'},['funding']);
    expect(result.sources).toEqual([]); expect(result.attempts[0].status).toBe('UNAVAILABLE');
  });
  it('reads raw JD and CV only, excluding historical projections and benchmark prose',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'radar-source-test-'));
    try {
      const file=join(dir,'cases.jsonl'), cv=join(dir,'cv.md');
      await writeFile(file,JSON.stringify({caseId:'02',company:'Example',role:'Head',identity:{canonicalJobId:'job'},job:{rawText:'Actual JD',storedProjection:{falseClaim:'CEO'}},evaluation:{verdict:'PURSUE'},currentDossier:{text:'DO NOT IMPORT'}}));
      await writeFile(cv,'Actual CV');
      const input=await readSliceInput(file,'02',[cv]);
      expect(input.sources.map(s=>s.text)).toEqual(['Actual JD','Actual CV']);
      expect(JSON.stringify(input)).not.toContain('DO NOT IMPORT');
      expect(JSON.stringify(input)).not.toContain('CEO');
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});


