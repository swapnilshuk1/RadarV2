import {createHash} from 'node:crypto';
import type {DatabaseAdapter} from '@/data/database';
import type {ReasoningModel} from '@/dossier/contracts';

export function checkpointHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
}

/** Persist narrative plans, proposals, repairs and reviews; validate every reuse.
 * Provider failures are never recorded. Changed contexts/recipes/models/requests
 * cannot reuse another generation's work. Concurrent callers use the saved winner.
 */
export function durableDossierModel(db:DatabaseAdapter, scope:string, model:ReasoningModel):ReasoningModel {
  const responses=new Map<unknown,{key:string;fingerprint:string}>();
  return {id:model.id, version:model.version, schemaFormat:model.schemaFormat,configurationFingerprint:model.configurationFingerprint,
    async discardResponse(response){
      const entry=responses.get(response);if(!entry)return;
      // This table is a resumable cache, not the immutable evaluation/audit store.
      // A malformed review must not poison every future retry of this request.
      await db.execute('DELETE FROM dossier_model_checkpoints WHERE scope_fingerprint=? AND request_fingerprint=? AND response_fingerprint=?',[scope,entry.key,entry.fingerprint]);
      responses.delete(response);
    },
    async generate(instruction,input,schema,metadata) {
      const key=checkpointHash({model:[model.id,model.version,model.configurationFingerprint],stage:metadata?.stage??"unspecified",instruction,input,schema,maxOutputTokens:metadata?.maxOutputTokens??null});
      const read=async()=>db.one<{response_json:string;response_fingerprint:string}>(
        'SELECT response_json,response_fingerprint FROM dossier_model_checkpoints WHERE scope_fingerprint=? AND request_fingerprint=?',[scope,key]);
      const parse=(row:{response_json:string;response_fingerprint:string})=>{
        const value=JSON.parse(row.response_json);
        if(checkpointHash(value)!==row.response_fingerprint)throw new Error('DOSSIER_CHECKPOINT_CORRUPT');
        if(responses.size>=64)responses.delete(responses.keys().next().value);
        responses.set(value,{key,fingerprint:row.response_fingerprint});
        return value;
      };
      const existing=await read();if(existing)return parse(existing);
      const response=await model.generate(instruction,input,schema,metadata);
      await db.execute('INSERT INTO dossier_model_checkpoints(scope_fingerprint,request_fingerprint,response_json,response_fingerprint) VALUES(?,?,?,?) ON CONFLICT(scope_fingerprint,request_fingerprint) DO NOTHING',
        [scope,key,JSON.stringify(response),checkpointHash(response)]);
      const saved=await read();if(!saved)throw new Error('DOSSIER_CHECKPOINT_NOT_PERSISTED');
      return parse(saved);
    }};
}