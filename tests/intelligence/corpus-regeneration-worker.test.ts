import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root=path.resolve(__dirname,"../..");
const read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8");

describe("durable corpus regeneration",()=>{
  it("queues from the web boundary and executes only in the dedicated worker",()=>{
    const server=read("src/lib/intelligence/scrape-server.ts");
    const worker=read("scripts/run-corpus-regeneration-worker.ts");
    expect(server).toContain("INSERT INTO corpus_regeneration_jobs");
    expect(server).not.toContain("runCorpusPipeline");
    expect(worker).toContain("runCorpusPipeline");
    expect(worker).toContain("status='processing'");
    expect(worker).toContain("status=?,stage=?");
    expect(worker).toContain('process.once("SIGTERM"');
  });
});
