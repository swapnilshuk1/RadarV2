import { describe, expect, it, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import { pool } from "../../scripts/scraper/utils/concurrency";
import { CONFIG } from "../../scripts/scraper/config";
import type { PortalContext } from "../../scripts/scraper/types";
vi.mock("../../scripts/scraper/utils/jitter",()=>({jitter:async()=>{},sleep:async()=>{},humanize:async()=>{}}));

describe("Acquisition waits and failure visibility", () => {
  it.each([['Naukri',naukriHandler],['Indeed',indeedHandler]] as const)("%s retains the full JD when optional title metadata is absent",async(portal,handler)=>{
    const jd="Lead the engineering organization, technology strategy and delivery of the platform. ".repeat(8);
    const titleRead=vi.fn(async(options?:{timeout:number})=>{expect(options?.timeout).toBe(CONFIG.optionalFieldTimeoutMs);return '';});
    const page:any={setExtraHTTPHeaders:async()=>{},goto:async()=>({status:()=>200}),url:()=>portal==='Indeed'?'https://in.indeed.com/viewjob?jk=abcdef1234567890':'https://www.naukri.com/job-listings-example',
      title:async()=>"VP Engineering",content:async()=>`<html><body><div id="jobs-desc"><div class="components_jd">${jd}</div></div></body></html>`,
      waitForFunction:vi.fn(async(_fn:unknown,_arg:unknown,options:any)=>{expect(options?.timeout).toBe(10000);}),
      evaluate:async()=>null,locator:(selector:string)=>({first:()=>({textContent:selector.startsWith('h1')?titleRead:async()=>selector==='#jobDescriptionText'?jd:'',innerHTML:async()=>`<p>${jd}</p>`})})};
    const context={portal,runId:'test',keyword:'VP',page:1,searchUrl:'https://example.com',activePage:page,logger:()=>{},isHttpDisabled:()=>true} as PortalContext;
    const detail=await handler.fetchDetail!(context,page.url());
    expect(detail.fetched).toBe(true);expect(detail.rawText).toContain('technology strategy');expect(detail.extractedTitle).toBeUndefined();expect(titleRead).toHaveBeenCalledOnce();
  });
  it("reports a rejected portal immediately while another portal is still running",async()=>{
    let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});const failed=vi.fn();
    const completion=pool(['LinkedIn','Naukri'],2,async portal=>{if(portal==='LinkedIn')throw new Error('failed to persist progress');await waiting;return portal;},failed);
    await new Promise(resolve=>setImmediate(resolve));expect(failed).toHaveBeenCalledWith(expect.any(Error),'LinkedIn');
    release();const results=await completion;expect(results[0]).toBeInstanceOf(Error);expect(results[1]).toBe('Naukri');
  });
});
