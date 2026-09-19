import { createFileRoute,Link,useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { getAcquisitionFeedFn,type AcquisitionFeedRow } from '@/lib/intelligence/acquisition-feed';

export const Route=createFileRoute('/scraped')({
  validateSearch:(search:Record<string,unknown>)=>({offset:Math.max(0,Number(search.offset)||0)}),
  loaderDeps:({search})=>({offset:search.offset}),
  loader:({deps})=>getAcquisitionFeedFn({data:deps}),
  head:()=>({meta:[{title:'Scraped jobs - RADAR'},{name:'description',content:'Every captured role and its current analysis status.'}]}),
  component:ScrapedFeed,
});
const labels:Record<AcquisitionFeedRow['state'],string>={NOT_PURSUED:'Evaluated ? not shortlisted',READY:'Dossier ready',PREPARING:'Preparing dossier',PROCESSING:'Analysis in progress',WAITING:'Awaiting processing',NEEDS_ATTENTION:'Needs attention',OUTSIDE_SEARCH:'Outside your search'};

function ScrapedFeed(){
  const {rows,counts,total,unadmittedCaptures,nextOffset}=Route.useLoaderData();
  const {offset}=Route.useSearch();
  const router=useRouter();
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')void router.invalidate();},15_000);return()=>clearInterval(timer);},[router]);
  return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
    <h1 className="text-3xl font-medium">Scraped jobs</h1>
    <p className="mt-3 max-w-2xl text-muted-foreground">{total} roles in your active search. Jobs stay visible here while their sources and dossiers are being processed.</p>
    {unadmittedCaptures>0&&<p role="status" className="mt-4 rounded border p-4">{unadmittedCaptures} additional source captures could not be added to this search. Their capture records are retained for recovery.</p>}
    <div className="my-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(labels).map(([state,label])=><div key={state} className="rounded border p-4"><div className="text-2xl tabular-nums">{counts.find(row=>row.state===state)?.count||0}</div><div className="text-sm text-muted-foreground">{label}</div></div>)}</div>
    <ul className="divide-y">{rows.map(row=><li key={row.id+':'+row.version} className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div className="min-w-0"><p className="text-xs uppercase tracking-wider text-muted-foreground">{row.source}</p><h2 className="mt-1 font-medium">{row.role}</h2><p className="text-sm text-muted-foreground">{row.company}{row.location?' · '+row.location:''}</p></div>
      {row.state==='READY'?<Link className="rounded border px-3 py-2 text-sm hover:bg-muted" to="/opportunity/$jobHash" params={{jobHash:row.jobHash}}>{row.decision} · View dossier</Link>:<span className="rounded border px-3 py-2 text-sm text-muted-foreground">{labels[row.state]}</span>}
    </li>)}</ul>
    {!rows.length&&<p className="py-10 text-muted-foreground">No captured roles in this search yet.</p>}
    <nav aria-label="Scraped jobs pages" className="mt-8 flex justify-between">
      {offset>0?<Link to="/scraped" search={{offset:Math.max(0,offset-100)}}>Previous</Link>:<span/>}
      {nextOffset!==null&&<Link to="/scraped" search={{offset:nextOffset}}>Next</Link>}
    </nav>
  </main>;
}
