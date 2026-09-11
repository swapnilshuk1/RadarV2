import { describe,it,expect } from 'vitest';
import { claim,digest,snapshot,freshness,usable,type IntelligenceSource } from '../../src/lib/intelligence/knowledge/model';
import { segmentDocument,extractCompanySections,endpointFitness } from '../../src/lib/intelligence/knowledge/documents';
import { FullDocumentSemanticSegmenter } from '../../src/lib/intelligence/knowledge/FullDocumentSemanticSegmenter';
import { narrate,NarrativePatternSelector } from '../../src/lib/intelligence/narrative/NarrativeRealizer';
import { narrativeContext } from '../../src/lib/intelligence/narrative/NarrativeContextBuilder';
import { IntelligencePipeline,JobDocumentConnector,EmployerSectionExtractor,OfficialCompanyConnector } from '../../src/lib/intelligence/knowledge/providers';
import type { CanonicalNarrativeInput } from '../../src/lib/intelligence/narrative/types';
import { ModelClaimExtractor } from '../../src/lib/intelligence/knowledge/ModelClaimExtractor';
import { ModelNarrativeRealizer } from '../../src/lib/intelligence/narrative/ModelNarrativeRealizer';
import { PlanBoundNarrativeRealizer, narrativePlan } from '../../src/lib/intelligence/narrative/PlanBoundNarrativeRealizer';
import { NarrativeAnalysisEngine } from '../../src/lib/intelligence/narrative/NarrativeAnalysisEngine';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import { SqliteIntelligenceStore } from '../../src/data/sqlite/repositories/SqliteIntelligenceStore';
const source:IntelligenceSource={id:'source',provider:'fixture',kind:'JOB_POSTING',authority:'PRIMARY',retrievedAt:'2026-09-11T00:00:00Z'};
function fact(text:string,predicate='role.responsibility') { return claim({subject:{type:predicate.startsWith('candidate')?'CANDIDATE':'ROLE',id:'subject'},predicate,value:text,displayText:text,epistemicState:'OBSERVED',sourceRefs:['source'],derivedFromClaimIds:[],generatedBy:{type:'DETERMINISTIC',provider:'fixture',version:'1'}}); }
function fixture():CanonicalNarrativeInput {
  const work=fact('Own regional revenue forecasts and pricing governance.');
  const candidate=fact('Owned regional pricing reviews and revenue planning.','candidate.precedent');
  return {identity:{tenantId:'tenant',personId:'person',canonicalJobId:'job',opportunityVersion:'version',contextFingerprint:'context'},company:'Example',role:'Director',knowledge:snapshot([source],[work,candidate]),evaluation:{state:'EVALUATED',verdict:'PURSUE',score:79,fingerprint:'unchanged'},drivers:[],relationships:[{id:'persisted-relation',relationship:'MATCH',candidateCapabilityKey:'pricing',jobCapabilityKey:'pricing',candidateEvidenceIds:['c-evidence'],jobEvidenceIds:['j-evidence'],candidateClaimIds:[candidate.id],jobClaimIds:[work.id],endpointFitness:'DIRECT'}]};
}
describe('Knowledge and narrative boundaries',()=>{
  it('normalizes provenance set ordering before assigning claim identity',()=>{
    const a=fact('A');const {id:_,...input}=a;
    expect(claim({...input,sourceRefs:['b','a','b']}).id).toBe(claim({...input,sourceRefs:['a','b']}).id);
  });
  it('replays additive storage and isolates tenants in a disposable database',async()=>{
    const raw=new Database(':memory:');try{
      const sql=readFileSync('src/data/sqlite/migrations/045_intelligence_knowledge.sql','utf8');raw.exec(sql);raw.exec(sql);
      const adapter=new SqliteAdapter(raw),a=new SqliteIntelligenceStore(adapter,'a'),b=new SqliteIntelligenceStore(adapter,'b');
      await a.save(snapshot([source],[fact('Source-backed statement.')]));
      expect(await a.claimsFor('subject')).toHaveLength(1);expect(await b.claimsFor('subject')).toHaveLength(0);
      expect(await a.resolveCompany(' Example   Co ', 'https://example.com')).toBe(await a.resolveCompany('example co','https://example.com'));
      await expect(a.resolveCompany('example co','https://other.example')).rejects.toThrow('conflicts');
      const storedSource={...source,contentHash:digest('exact source')};await a.saveSourceDocument({source:storedSource,text:'exact source'});
      await expect(a.saveSourceDocument({source:storedSource,text:'changed'})).rejects.toThrow('mismatch');
    }finally{raw.close();}
  });
  it('rejects model extraction without an exact source quote',async()=>{
    const extractor=new ModelClaimExtractor({id:'fixture',version:'1',generate:async()=>({claims:[{predicate:'company.market',statement:'International business',quote:'Not in source'}]})});
    await expect(extractor.extract({source,text:'We build instruments.'},{companyId:'company',observedAt:source.retrievedAt,documents:[]})).rejects.toThrow('quote');
  });
  it('omits only a narrator sentence whose relationship lacks both endpoints',async()=>{
    const input=fixture();const realizer=new ModelNarrativeRealizer({id:'fixture',version:'1',generate:async()=>({blocks:[{kind:'POSITIONING',title:'Positioning',sentences:[{text:'Use the linked example.',claims:[0],relationships:[0],state:'INFERRED'}]}]})});
    expect((await narrate(input,realizer)).blocks).toEqual([]);
  });
  it('omits only a model sentence that upgrades a hypothesis to an observed fact',async()=>{
    const input=fixture();input.knowledge.claims.forEach(c=>c.epistemicState='ASSUMED');
    const realizer=new ModelNarrativeRealizer({id:'fixture',version:'1',generate:async()=>({blocks:[{kind:'THESIS',title:'Brief',sentences:[{text:'The company is expanding.',claims:[0],relationships:[],state:'OBSERVED'}]}]})});
    expect((await narrate(input,realizer)).blocks).toEqual([]);
  });
  it('binds model prose to a deterministic narrative plan before realization',async()=>{
    const input=fixture();const plan=narrativePlan(input);
    const model={id:'fixture',version:'1',generate:async(_instruction:string,data:any)=>({sentences:data.moves.map((m:any)=>({id:m.id,text:`A specific interpretation of ${m.title}.`}))})};
    const output=await narrate(input,new PlanBoundNarrativeRealizer(model));
    expect(output.blocks).toHaveLength(plan.length);
    expect(output.blocks.flatMap(b=>b.sentences).every(s=>s.claimIds.length>0)).toBe(true);
  });
  it('rejects a model that changes the pre-bound narrative move set',async()=>{
    const input=fixture();const model={id:'fixture',version:'1',generate:async()=>({sentences:[]})};
    await expect(narrate(input,new PlanBoundNarrativeRealizer(model,1))).rejects.toThrow('omitted');
  });
  it('presents evaluator relationships at capability level even without a quantified candidate accomplishment',()=>{
    const plan=narrativePlan(fixture());
    expect(plan.some(move=>move.kind==='ADVANTAGE')).toBe(true);
    expect(plan.some(move=>move.kind==='POSITIONING')).toBe(true);
  });
  it('preserves exact complete document coverage beyond 6000 characters',()=>{
    const text='Role Overview\n'+ 'Description. '.repeat(600)+'\nAbout Company\nWe operate in twelve countries.';
    const sections=segmentDocument({source,text});
    expect(sections.map(s=>s.text).join('')).toBe(text);
    for(const s of sections) expect(text.slice(s.start,s.end)).toBe(s.text);
    expect(sections.at(-1)?.kind).toBe('ABOUT_COMPANY');
  });
  it('accepts only exact model-classified semantic spans and retains complete source coverage',async()=>{
    const text='Company background.\nOwn regional pricing governance.\nCandidate benefits.';
    const segmenter=new FullDocumentSemanticSegmenter({id:'fixture',version:'1',generate:async()=>({segments:[
      {kind:'RESPONSIBILITIES',quote:'Own regional pricing governance.',confidence:.92},
      {kind:'ABOUT_COMPANY',quote:'Not present',confidence:.9},
    ]})});
    const sections=await segmenter.segment({source,text});
    expect(sections.map(section=>section.text).join('')).toBe(text);
    expect(sections.some(section=>section.kind==='RESPONSIBILITIES')).toBe(true);
    expect(sections.every(section=>text.slice(section.start,section.end)===section.text)).toBe(true);
  });
  it('keeps company geography separate from role ownership',()=>{
    const claims=extractCompanySections({source,text:'About Company\nWe operate in twelve countries.'},'company');
    expect(claims[0].subject).toEqual({type:'COMPANY',id:'company'});
    expect(claims[0].usage?.evaluation).toBe(false);
  });
  it('supports new predicates without a schema enum',()=>expect(fact('Four thousand employees','company.employee_count').predicate).toBe('company.employee_count'));
  it('uses deterministic claim identity and distinguishes contradictory assertions',()=>{
    expect(fact('A').id).toBe(fact('A').id);
    const a=fact('A'),b=fact('B'); const s=snapshot([source],[a,b],[{from:a.id,to:b.id,relation:'CONTRADICTS'}]);
    expect(s.claims).toHaveLength(2); expect(s.edges).toHaveLength(1);
  });
  it('rejects missing source and derived references',()=>expect(()=>snapshot([],[fact('A')])).toThrow('provenance'));
  it('retains expired knowledge without enabling evaluation by default',()=>{
    const c={...fact('An earlier count'),validUntil:'2025-01-01'};
    expect(freshness(c,'2026-01-01')).toBe('STALE'); expect(usable(c,'narration')).toBe(true); expect(usable(c,'evaluation')).toBe(false);
  });
  it('distinguishes endpoint labels, duties and fused structures',()=>{
    expect(endpointFitness('marketing')).toBe('ABSTRACT');
    expect(endpointFitness('Own regional forecasting and pricing governance.')).toBe('DIRECT');
    expect(endpointFitness('Required: pricing experience; forecasting experience.')).toBe('COMPOUND');
    expect(endpointFitness('Plan KRA2 Deliver KRA3')).toBe('MALFORMED');
  });
  it('preserves evaluator identity and never manufactures a second relationship',async()=>{
    const input=fixture(),before=digest(input); const output=await narrate(input);
    expect(digest(input)).toBe(before); expect(output.evaluation).toEqual(input.evaluation);
    expect(output.blocks.flatMap(b=>b.sentences.flatMap(s=>s.relationshipIds)).every(id=>id==='persisted-relation')).toBe(true);
  });
  it('keeps evaluator capability labels as capability-level, not accomplishment-level, relevance',()=>{
    const input=fixture();const label=fact('marketing','candidate.capability');input.knowledge=snapshot([source],[...input.knowledge.claims,label]);input.relationships[0].candidateClaimIds=[label.id];
    expect(narrativeContext(input).relationships[0]?.editorialStrength).toBe('CAPABILITY_LEVEL');
  });
  it('keeps a grounded responsibility relationship usable without requiring a quantified result',()=>{
    const input=fixture();
    input.knowledge.claims[1].displayText='Led regional pricing governance across markets.';
    expect(narrativeContext(input).relationships[0]?.editorialStrength).toBe('GROUNDED');
  });
  it('accepts analyst synthesis only through move-bound semantic handles',async()=>{
    const input=fixture();const move=narrativePlan(input)[0]!;
    const analyst=new NarrativeAnalysisEngine({id:'fixture',version:'1',generate:async(_instruction:string,data:any)=>({insights:[{moveId:move.id,text:'The mandate combines revenue planning with pricing control.',state:'SYNTHESIZED',claimHandles:data.moves[0].claimHandles,relationshipHandles:[]} ]})});
    const insights=await analyst.analyze(input,[move]);
    expect(insights).toHaveLength(1);expect(insights[0]?.claimIds).toEqual(move.claimIds);
  });
  it('source-only blueprint never emits personal relevance even if passed a relationship',async()=>{
    const input=fixture();input.evaluation={state:'NOT_EVALUABLE',verdict:null,score:null,fingerprint:null}; const output=await narrate(input);
    expect(output.blueprint).toBe('SOURCE_RESEARCH_BRIEF');expect(output.blocks.some(b=>['ADVANTAGE','POSITIONING'].includes(b.kind))).toBe(false);
  });
  it('generates stable outputs independent of invocation history',async()=>{
    const input=fixture(),first=await narrate(input);await narrate({...input,company:'Another'});expect(await narrate(input)).toEqual(first);
    expect(NarrativePatternSelector(input)).toEqual(NarrativePatternSelector(input));
  });
  it('every sentence resolves to known claim and insight identifiers',async()=>{
    const input=fixture(),output=await narrate(input);const ids=new Set(input.knowledge.claims.map(c=>c.id));
    for(const sentence of output.blocks.flatMap(b=>b.sentences)){expect(sentence.insightIds.length).toBeGreaterThan(0);expect(sentence.claimIds.every(id=>ids.has(id))).toBe(true);}
  });
  it('shares company source-set processing and accepts a connector through the interface',async()=>{
    const pipeline=new IntelligencePipeline([new JobDocumentConnector()],new EmployerSectionExtractor());
    const context={companyId:'company',observedAt:source.retrievedAt,documents:[{source,text:'About Company\nWe make instruments.'}]};
    const a=await pipeline.run({type:'EXTRACT_JOB_DOCUMENT',subjectId:'job-a'},context);const b=await pipeline.run({type:'EXTRACT_JOB_DOCUMENT',subjectId:'job-b'},context);
    expect(a.snapshot).toBe(b.snapshot);
  });
  it('refuses non-public origins for official research retrieval',()=>{
    expect(()=>new OfficialCompanyConnector('https://localhost','2026-09-11')).toThrow('public');
    expect(()=>new OfficialCompanyConnector('https://127.0.0.1','2026-09-11')).toThrow('public');
  });
});
