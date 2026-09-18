import {getDatabaseAdapter} from '../src/data/database';
import {recoverStagedProviderFailures} from '../src/lib/intelligence/staged/StagedProviderRecovery';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context');if(!context)throw new Error('EXPLICIT_CONTEXT_REQUIRED');
const db=getDatabaseAdapter();
const bindings=await db.many<{tenant_id:string;person_id:string;search_plan_id:string}>(`SELECT tenant_id,person_id,search_plan_id FROM evaluation_context_scopes WHERE context_fingerprint=?`,[context]);
if(bindings.length!==1)throw new Error('RECOVERY_SCOPE_MUST_BE_UNAMBIGUOUS');
const binding=bindings[0];
const rows=await recoverStagedProviderFailures(db,{tenantId:binding.tenant_id,personId:binding.person_id,searchPlanId:binding.search_plan_id,contextFingerprint:context},Number(option('limit')||'1'),process.argv.includes('--execute'));
console.log(JSON.stringify({selected:rows.length,rows}));
