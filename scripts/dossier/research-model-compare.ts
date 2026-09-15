import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDossier } from '../../src/dossier/pipeline';
import { GeminiJsonModel } from '../../src/lib/model/json-model';
import type { ContextProvider, ReasoningModel, SliceInput } from '../../src/dossier/contracts';
import { readSliceInput } from './source-input';
import { adcTokenProvider } from './credentials';

class ResearchComplete extends Error {}
class CaptureResearch implements ReasoningModel {
  readonly id: string; readonly version: string;
  input?: unknown; proposal?: unknown;
  constructor(private inner: ReasoningModel) { this.id=inner.id; this.version=inner.version; }
  async generate(instruction: string, input: unknown, schema?: Record<string, unknown>) {
    if (input && typeof input === 'object' && 'research' in input) throw new ResearchComplete();
    const output=await this.inner.generate(instruction,input,schema);
    if (input && typeof input === 'object' && 'evidence' in input) { this.input=input; this.proposal=output; }
    return output;
  }
}
const { values }=parseArgs({options:{cases:{type:'string'},case:{type:'string',default:'01'},candidate:{type:'string',multiple:true},evidence:{type:'string'},output:{type:'string',default:'.radar/dossier-runs/2070-research-model-comparison.json'},models:{type:'string',multiple:true}}});
if (!values.cases || !values.candidate?.length || !values.evidence) throw new Error('Requires --cases, --case, --candidate, and --evidence');
const frozen=JSON.parse(await readFile(values.evidence,'utf8')) as { evidence:{lineage:SliceInput['sources']}; acquisition:unknown };
const base=await readSliceInput(values.cases,values.case,values.candidate);
const input:SliceInput={...base,sources:[...base.sources,...frozen.evidence.lineage.filter(source=>source.plane==='CONTEXT')]};
const provider:ContextProvider={id:'frozen-context',async acquire(){return {sources:[],attempts:[]};}};
const project=process.env.GCP_PROJECT_ID; if (!project) throw new Error('GCP_PROJECT_ID is required');
const models=values.models?.length ? values.models : ['gemini-2.5-flash','gemini-2.5-pro'];
const results=[] as unknown[];
for (const version of models) {
  const capture=new CaptureResearch(new GeminiJsonModel(project,adcTokenProvider(),fetch,{model:version,maxOutputTokens:24576,temperature:0.25,timeoutMs:240000}));
  try { await buildDossier(input,[provider],capture); throw new Error('Research comparison unexpectedly composed a dossier'); }
  catch (error) { if (!(error instanceof ResearchComplete)) throw error; }
  if (!capture.input || !capture.proposal) throw new Error(`No accepted research proposal captured for ${version}`);
  results.push({model:`${capture.id}/${capture.version}`,researchInput:capture.input,researchProposal:capture.proposal});
}
await mkdir(dirname(resolve(values.output)),{recursive:true});
await writeFile(values.output,JSON.stringify({sourceArtifact:values.evidence,models:results},null,2));
console.log(resolve(values.output));
