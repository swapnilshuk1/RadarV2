import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryBlobStore } from "../../src/lib/storage/blob-store";
import { AcquisitionOutbox } from "../../src/acquisition/outbox";
import { AcquisitionTransferSession, TransferIncompleteError } from "../../src/acquisition/transfer-session";
import type { CanonicalIngestionResult, IngestOpportunityPayload } from "../../src/acquisition/ingestion-service";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive:true,force:true}); });
const scope = { mode:"SCOPED" as const, tenantId:"tenant-a",personId:"person-a",runId:"run-a" };
const lease = { owner:"worker",token:"lease",executionToken:"execution" };
const payload = (id: string): IngestOpportunityPayload => ({sourcePortal:"LinkedIn",sourceJobId:id,canonicalUrl:`https://www.linkedin.com/jobs/view/${id}`,jobTitle:"VP Engineering",companyName:"Example",location:"Mumbai",rawContent:"Lead the engineering team and technology strategy."});
const result = {canonicalJobId:"canonical",opportunityVersion:"version",contentHash:"hash"} as CanonicalIngestionResult;
function directory() {const dir = fs.mkdtempSync(path.join(os.tmpdir(),"radar-transfer-"));directories.push(dir);return dir;}
const tick = () => new Promise(resolve => setImmediate(resolve));

describe("Independent durable acquisition transfer", () => {
  it("continues staging while upload acknowledgements are blocked, with bounded concurrency", async () => {
    const dir=directory();const store=new MemoryBlobStore();let active=0,max=0;
    let release!: () => void;const gate=new Promise<void>(resolve => {release=resolve;});
    const outbox=new AcquisitionOutbox(dir,store,async () => {active++;max=Math.max(max,active);await gate;active--;return result;});
    const admitted: string[]=[];
    const session=new AcquisitionTransferSession(outbox,scope,lease,async entry => {admitted.push(String(entry.localContext?.cardId));},() => {},2);
    for(let i=0;i<5;i++) session.stage(payload(String(i)),{cardId:String(i)});
    expect(fs.readdirSync(dir).filter(name=>name.endsWith('.json'))).toHaveLength(5);
    await tick();expect(max).toBe(2);expect(admitted).toEqual([]);
    let drained=false;const draining=session.drain().then(()=>{drained=true;});
    await tick();expect(drained).toBe(false);
    release();await draining;expect(admitted).toHaveLength(5);expect(max).toBe(2);
    expect(outbox.filesForRun(scope)).toEqual([]);
  });

  it("recovers a lost acknowledgement with a new lease and applies the receipt once", async () => {
    const dir=directory();const store=new MemoryBlobStore();let submitted=0;
    const outbox=new AcquisitionOutbox(dir,store,async reference=>{submitted++;if(submitted===1)throw Object.assign(new Error('offline'),{retryable:true});expect(reference.lease.token).toBe('replacement');return result;});
    const first=new AcquisitionTransferSession(outbox,scope,lease,async()=>{},()=>{});
    first.stage(payload('1'),{cardId:'1'});
    await expect(first.drain()).rejects.toMatchObject({name:'TransferIncompleteError',retryable:true});
    expect(outbox.filesForRun(scope)).toHaveLength(1);
    let applied=0;
    const restarted=new AcquisitionTransferSession(outbox,scope,{...lease,token:'replacement'},async()=>{applied++;},()=>{});
    restarted.recover();await restarted.drain();expect(applied).toBe(1);
    const again=new AcquisitionTransferSession(outbox,scope,lease,async()=>{applied++;},()=>{});
    again.recover();await again.drain();expect(applied).toBe(1);expect(submitted).toBe(2);
  });

  it("recovers acknowledgement persisted before local completion without resubmitting", async () => {
    const dir=directory();const store=new MemoryBlobStore();let submitted=0;
    const outbox=new AcquisitionOutbox(dir,store,async()=>{submitted++;return result;});
    const file=outbox.stage(payload('1'),scope,{cardId:'1'});await outbox.replay(file,lease);
    let applied=0;const session=new AcquisitionTransferSession(outbox,scope,lease,async()=>{applied++;},()=>{});
    session.recover();await session.drain();expect(applied).toBe(1);expect(submitted).toBe(1);
  });

  it("does not recover another person or run and fails closed on an integrity rejection", async () => {
    const dir=directory();const outbox=new AcquisitionOutbox(dir,new MemoryBlobStore(),async()=>{throw new Error('integrity rejection');});
    outbox.stage(payload('foreign'),{...scope,personId:'other'},{});
    const errors: Error[]=[];const session=new AcquisitionTransferSession(outbox,scope,lease,async()=>{},(_,error)=>errors.push(error));
    session.recover();await session.drain();expect(errors).toHaveLength(0);
    const next=new AcquisitionTransferSession(outbox,scope,lease,async()=>{},(_,error)=>errors.push(error));next.stage(payload('own'),{});
    try {await next.drain();throw new Error('unexpected success');} catch(error) {expect(error).toBeInstanceOf(TransferIncompleteError);expect((error as TransferIncompleteError).retryable).toBe(false);}
    expect(errors).toHaveLength(1);expect(outbox.filesForRun(scope)).toHaveLength(1);
  });
});
