import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepareFrozenResearchInput, runFrozenResearch } from '../../src/dossier/pipeline';
import { GeminiJsonModel } from '../../src/lib/model/json-model';
import type { ContextProvider, ReasoningModel, SliceInput } from '../../src/dossier/contracts';
import { readSliceInput } from './source-input';
import { adcTokenProvider } from './credentials';

const { values }=parseArgs({options:{cases:{type:'string'},case:{type:'string',default:'01'},candidate:{type:'string',multiple:true},evidence:{type:'string'},output:{type:'string',default:'.radar/dossier-runs/2070-research-model-comparison.json'},models:{type:'string',multiple:true}}});
if (!values.cases || !values.candidate?.length || !values.evidence) throw new Error('Requires --cases, --case, --candidate, and --evidence');
const prior=JSON.parse(await readFile(values.evidence,'utf8')) as { evidence:{lineage:SliceInput['sources']} };
const base=await readSliceInput(values.cases,values.case,values.candidate);
const input:SliceInput={...base,sources:[...base.sources,...prior.evidence.lineage.filter(source=>source.plane==='CONTEXT')]};
const provider:ContextProvider={id:'frozen-context',async acquire(){return {sources:[],attempts:[]};}};
const project=process.env.GCP_PROJECT_ID; if (!project) throw new Error('GCP_PROJECT_ID is required');
const options={maxOutputTokens:24576,temperature:0.25,timeoutMs:240000};
const extractionModel=new GeminiJsonModel(project,adcTokenProvider(),fetch,{...options,model:'gemini-2.5-flash'});
const frozen=await prepareFrozenResearchInput(input,[provider],extractionModel);
const models=values.models?.length ? values.models : ['gemini-2.5-flash','gemini-2.5-pro'];
const results=[] as unknown[];
for (const version of models) {
  const model=new GeminiJsonModel(project,adcTokenProvider(),fetch,{...options,model:version});
  const research=await runFrozenResearch(frozen,model);
  if (frozen.fingerprint !== frozen.fingerprint) throw new Error(`Frozen input fingerprint changed for ${version}`);
  results.push({model:`${model.id}/${model.version}`,frozenInputFingerprint:frozen.fingerprint,research});
}
if (!results.every((result:any)=>result.frozenInputFingerprint===frozen.fingerprint)) throw new Error('Research models did not share one frozen input');
await mkdir(dirname(resolve(values.output)),{recursive:true});
await writeFile(values.output,JSON.stringify({sourceArtifact:values.evidence,frozenInput:frozen,models:results},null,2));
console.log(resolve(values.output));
