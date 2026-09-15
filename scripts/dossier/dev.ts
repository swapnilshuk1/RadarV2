import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDossier } from '../../src/dossier/pipeline';
import { CompanyWebsiteProvider } from '../../src/dossier/context';
import { GeminiJsonModel } from '../../src/lib/model/json-model';
import type { Dossier } from '../../src/dossier/contracts';
import { readSliceInput } from './source-input';
import { readAuthoritativeSliceInput } from '../../src/dossier/source-authority';
import { adcTokenProvider } from './credentials';

const { values } = parseArgs({ options: { cases: { type: 'string' }, case: { type: 'string', default: '02' }, candidate: { type: 'string', multiple: true }, job: { type: 'string' }, person: { type: 'string' }, document: { type: 'string', multiple: true }, name: { type: 'string' }, context: { type: 'string', multiple: true }, port: { type: 'string', default: '4317' } } });
const useAuthority = Boolean(values.job || values.person || values.document?.length);
if (useAuthority && (!values.job || !values.person || !values.name)) throw new Error('Canonical mode requires --job <jobHash> --person <personId> --name <candidate name> [--document <candidateDocumentId>]');
if (!useAuthority && (!values.cases || !values.candidate?.length)) throw new Error('Usage: use canonical --job/--person/--name, or fixture --cases <cases.jsonl> --candidate <CV.md>');
const input = useAuthority
  ? await readAuthoritativeSliceInput({ jobHash: values.job!, personId: values.person!, candidateDocumentIds: values.document, candidateName: values.name! })
  : await readSliceInput(values.cases!, values.case!, values.candidate!);
const project = process.env.GCP_PROJECT_ID;
if (!project) throw new Error('GCP_PROJECT_ID is required; load your existing environment');
const model = new GeminiJsonModel(project, adcTokenProvider(), fetch, { maxOutputTokens: 24576, temperature: 0.25, timeoutMs: 240000 });
const providers = [new CompanyWebsiteProvider((values.context ?? []).map(url => ({ url, title: `${input.opportunity.company} — company website` })))];
let dossier: Dossier | undefined;
let stage = 'Ready to generate';
let error: string | undefined;
let running: Promise<void> | undefined;
const port = Number(values.port);
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({
  configFile: false, root: resolve('src/dossier/development'),
  plugins: [react(), tailwind(), { name: 'dossier-local-api', configureServer(vite) {
    vite.middlewares.use('/api/dossier', (req, res) => {
      // Private evidence stays in process memory. Reject foreign origins and DNS rebinding.
      if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) { res.statusCode = 403; res.end(); return; }
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) { res.statusCode = 403; res.end(); return; }
        if (!running) {
          error = undefined; dossier = undefined;
          running = buildDossier(input, providers, model, value => { stage = value; console.log(value); })
            .then(result => { dossier = result; console.log(`Dossier ready: ${result.verdict.verdict}; ${result.evidence.lineage.length} sources`); })
            .catch(e => { error = e instanceof Error ? e.message : 'Generation failed'; stage = 'Needs attention'; console.error(error); })
            .finally(() => { running = undefined; });
        }
        res.statusCode = 202;
      } else if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
      res.end(JSON.stringify({ dossier, stage, error, running: Boolean(running), opportunity: input.opportunity }));
    });
  } }],
  server: { host: '127.0.0.1', port, strictPort: true, cors: false, fs: { allow: [process.cwd()] } },
});
await server.listen();
console.log(`Dossier development page: ${origin}`);
