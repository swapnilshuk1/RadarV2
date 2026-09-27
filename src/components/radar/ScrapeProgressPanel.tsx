import { useScrapeProgress } from "./ScrapeProgressProvider";

const statusLabels: Record<string, string> = {
  queued: "Search queued — waiting for a worker",
  initializing: "Preparing search",
  waiting_for_confirmation: "Search needs your confirmation",
  running: "Searching job sources",
  enriching: "Reading captured job details",
  completing: "Finishing analysis",
  stopping: "Stop requested",
  aborted: "Search stopped",
  completed: "Search complete",
  failed: "Search needs attention",
};

export function ScrapeProgressPanel() {
  const { runState, isMinimized, isDismissed, isConfirmationOpen, requestStop, confirmStop, cancelStop, minimize, dismiss, confirmScrape } = useScrapeProgress();
  if (!runState || isDismissed) return null;
  const label = statusLabels[runState.status] || "Checking search status";
  const stopping = runState.status === "stopping";
  const sources: Record<string, string> = { pending: "Waiting", searching: "Searching", completed: "Finished", failed: "Needs attention" };
  if (isMinimized) return <button onClick={minimize} className="fixed bottom-6 right-6 z-50 rounded-full border bg-background px-4 py-3 shadow-xl">{label} · {runState.opportunitiesFound} captured · Expand</button>;
  return <>
    <aside aria-label="Search progress" className="fixed bottom-6 right-6 z-50 w-[390px] max-w-[calc(100vw-32px)] max-h-[80vh] overflow-auto rounded-xl border bg-background p-5 shadow-2xl space-y-4 text-sm">
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold" role="status">{label}</h2>
        <div className="flex gap-3"><button aria-label="Minimize" onClick={minimize}>−</button><button aria-label="Dismiss" onClick={dismiss}>×</button></div>
      </div>
      <div className="flex flex-wrap gap-3">{Object.entries(runState.sources).map(([portal, state]) => <div key={portal}><strong>{portal}</strong><p className="text-muted-foreground">{sources[state] || "Status unavailable"}</p></div>)}</div>
      <dl className="grid grid-cols-3 gap-2 border-y py-3">
        <div><dt>Captured</dt><dd className="text-xl">{runState.opportunitiesFound}</dd></div>
        <div><dt>Enriched</dt><dd className="text-xl">{runState.enrichedCount ?? 0}</dd></div>
        <div><dt>Evaluated</dt><dd className="text-xl">{runState.evaluatedCount}</dd></div>
      </dl>
      <p className="text-muted-foreground">{runState.remainingCount} awaiting evaluation. Completed evaluations may still need dossier preparation; see Scraped jobs for each role.</p>
      {runState.status === "queued" && <p>Your search is saved. It will begin when the search worker is available. You can leave this page or cancel the queued search.</p>}
      {stopping && <p>The worker will stop at its next safe checkpoint. Captured jobs remain saved. If shutdown is interrupted, cancel the remaining search below.</p>}
      {runState.status === "completed" && runState.opportunitiesFound === 0 && <p>No opportunities were captured in this search. Review your search criteria or try again later.</p>}
      {runState.errorMessage && <p role="alert" className="text-red-600">{runState.errorMessage}</p>}
      {!!runState.recentActivities?.length && <ul className="space-y-1 text-xs text-muted-foreground">{runState.recentActivities.slice(0, 4).map((activity, index) => <li key={index}>{activity}</li>)}</ul>}
      {runState.updatedAt && <p className="text-xs text-muted-foreground">Last update: {runState.updatedAt}</p>}
      {runState.status === "waiting_for_confirmation" ? <button onClick={confirmScrape} className="w-full rounded border p-3">Start search</button> : runState.isActive ? <button onClick={requestStop} className="w-full rounded border p-3">{stopping ? "Cancel remaining search" : "Stop search"}</button> : <button onClick={dismiss} className="w-full rounded border p-3">Close progress</button>}
    </aside>
    {isConfirmationOpen && <div role="dialog" aria-modal="true" aria-labelledby="stop-dialog-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="max-w-md rounded-xl border bg-background p-6 space-y-4">
        <h2 id="stop-dialog-title" className="text-xl">{stopping ? "Cancel remaining search?" : "Stop this search?"}</h2>
        <p>Captured jobs will remain saved. {stopping ? "The run will be marked stopped and no further search work will be scheduled." : "Active work will stop at its next safe checkpoint."}</p>
        <div className="flex justify-end gap-3"><button onClick={cancelStop} className="rounded border p-2">Keep current state</button><button onClick={confirmStop} className="rounded border p-2">Confirm stop</button></div>
      </div>
    </div>}
  </>;
}
