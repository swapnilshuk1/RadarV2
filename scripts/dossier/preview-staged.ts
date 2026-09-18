/** Local read-only preview of an already persisted rich dossier. No model calls. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
import { getDatabaseAdapter } from '../../src/data/database';
import { dossierSchema } from '../../src/dossier/contracts';
import { RICH_DOSSIER_VERSION } from '../../src/data/sqlite/repositories/SqliteRichDossierStore';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context'),job=option('job'),file=option('file');
let raw:unknown;
if(file){
  // Local evidence review never opens a database or starts a model/worker.
  raw=JSON.parse(readFileSync(resolve(file),'utf8').replace(/^\uFEFF/,''));
}else{
  if(!context||!job)throw new Error('Explicit --file or --context and --job required');
  const row=await getDatabaseAdapter().one<{presentation_json:string}>(`SELECT presentation_json FROM materialized_dossier_presentations WHERE evaluation_context_fingerprint=? AND canonical_job_id=? AND presentation_version=?`,[context,job,RICH_DOSSIER_VERSION]);
  if(!row)throw new Error('Persisted rich dossier not found');
  raw=JSON.parse(row.presentation_json);
}
const dossier=dossierSchema.parse(raw);
const port=Number(option('port')||'4318');
const origin=`http://127.0.0.1:${port}`;
const server=await createServer({configFile:false,root:resolve('src/dossier/development'),plugins:[react(),tailwind(),{
  name:'persisted-dossier-preview',configureServer(vite){vite.middlewares.use('/api/dossier',(req,res)=>{
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin)){res.statusCode=403;res.end();return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    res.end(JSON.stringify({dossier,stage:'Ready',running:false,opportunity:dossier.opportunity}));
  });},
}],server:{host:'127.0.0.1',port,strictPort:true,cors:false,fs:{allow:[process.cwd()]}}});
await server.listen();console.log(`Persisted dossier preview: ${origin}`);
