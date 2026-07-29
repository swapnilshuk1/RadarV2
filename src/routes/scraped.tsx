import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getScrapedJobs, getScraperCounts } from "../data/scraped-jobs";
import { getPipelineStatsFn } from "../lib/intelligence/scrape-server";

export const Route = createFileRoute("/scraped")({
  head: () => ({
    meta: [
      { title: "Scraped feed — RADAR" },
      { name: "description", content: "Every role RADAR scraped from LinkedIn, Naukri, and Indeed — including the ones filtered before the shortlist." },
      { property: "og:title", content: "Scraped feed — RADAR" },
      { property: "og:description", content: "The raw job pipeline that feeds the RADAR shortlist." },
    ],
  }),
  component: ScrapedFeed,
});

function ScrapedFeed() {
  const [version, setVersion] = useState(0);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    window.addEventListener("radar:opportunities", onChange);
    return () => window.removeEventListener("radar:opportunities", onChange);
  }, []);

  // Poll background daemon and pipeline telemetry stats every 3 seconds
  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const data = await getPipelineStatsFn();
        if (active && data) {
          setStats(data);
        }
      } catch (err) {
        console.error("Failed to load pipeline stats:", err);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const c = getScraperCounts();
  const jobs = getScrapedJobs();

  // Adjust total discovered count dynamically if live stats are loaded
  const displayTotal = stats?.discovered ?? c.total;

  return (
    <div className="min-h-screen bg-background text-ink">
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-4 sm:px-8 py-12">
          <h1 className="text-3xl font-medium tracking-tight text-ink">Scraped feed</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
            {displayTotal} roles pulled from LinkedIn, Naukri, and Indeed in the last 10 days. RADAR promotes {c.shortlisted} to the shortlist and filters {c.filtered} before building a brief.
          </p>
          <div className="mt-6 flex flex-wrap gap-6 text-[13px]">
            <Meta label="LinkedIn" value={c.bySource.LinkedIn} />
            <Meta label="Naukri" value={c.bySource.Naukri} />
            <Meta label="Indeed" value={c.bySource.Indeed} />
            <Meta label="Shortlisted" value={c.shortlisted} tint="text-decision-pursue" />
            <Meta label="Filtered" value={stats?.failed ? (stats.failed + (c.filtered - 9)) : c.filtered} tint="text-ink-muted" />
          </div>
        </div>
      </section>

      {/* Visual Pipeline & Telemetry Dashboard */}
      <section className="bg-ink/[0.02] border-b border-hairline py-8">
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Column 1: Ingestion Pipeline (System) */}
            <div className="bg-background border border-hairline rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${stats?.enriching > 0 ? "bg-decision-pursue animate-pulse" : "bg-ink-muted/50"}`}></span>
                  Ingestion Pipeline (System)
                </span>
                <span className="text-[12px] text-ink-muted">
                  {stats?.enriching > 0 ? "AI Enriching..." : "Daemon Idle"}
                </span>
              </div>
              
              {/* Process Flow Indicators */}
              <div className="flex items-center gap-4 py-2">
                <PipelineStage 
                  label="Discovered" 
                  value={stats?.discovered ?? c.total} 
                  sub="Raw Snapshots"
                />
                <span className="text-ink-muted/40 text-[14px]">➔</span>
                <PipelineStage 
                  label="AI Enriching" 
                  value={stats?.enriching ?? 0} 
                  sub="LLM Active"
                  active={stats?.enriching > 0}
                />
                <span className="text-ink-muted/40 text-[14px]">➔</span>
                <PipelineStage 
                  label="Analyzed" 
                  value={stats?.completed ?? 0} 
                  sub="SQLite Staged"
                />
              </div>

              {/* Ingestion Telemetry Numbers */}
              <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-hairline">
                <Metric label="Oldest Pending" value={stats?.oldestPendingSec ? `${Math.ceil(stats.oldestPendingSec / 60)}m ago` : "—"} />
                <Metric label="Throughput" value={`${stats?.throughputPerMin ?? 0.0}/min`} />
                <Metric label="Cache Hit %" value={`${stats?.cacheHitRate ?? 0}%`} sub={`(${stats?.cacheSaves ?? 0} saves)`} />
              </div>
            </div>

            {/* Column 2: Recommendation Pipeline (Career) */}
            <div className="bg-background border border-hairline rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-decision-pursue"></span>
                  Recommendation Pipeline (Career)
                </span>
                <span className="text-[12px] text-ink-muted">Policy Active</span>
              </div>

              {/* Recommendation Stage Flow */}
              <div className="flex items-center gap-4 py-2">
                <PipelineStage 
                  label="Staged" 
                  value={stats?.completed ?? 0} 
                  sub="Awaiting Score"
                />
                <span className="text-ink-muted/40 text-[14px]">➔</span>
                <PipelineStage 
                  label="Filtered" 
                  value={stats?.failed ? (stats.failed + (c.filtered - 9)) : c.filtered} 
                  sub="Low Alignment"
                  tint="text-ink-muted"
                />
                <span className="text-ink-muted/40 text-[14px]">➔</span>
                <PipelineStage 
                  label="Shortlisted" 
                  value={c.shortlisted} 
                  sub="VP+ Match List"
                  tint="text-decision-pursue font-semibold"
                />
              </div>

              {/* Error logs overlay */}
              <div className="mt-6 pt-4 border-t border-hairline">
                <div className="flex items-center justify-between text-[11px] font-mono text-ink-muted uppercase tracking-wider mb-2">
                  <span>API Errors & Retries</span>
                  {stats?.retry > 0 && <span className="text-decision-pursue animate-pulse font-semibold">Retrying {stats.retry}...</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
                  <span>Rate Limits: <strong className="font-medium text-ink tabular-nums">{stats?.errorDistribution?.RATE_LIMIT ?? 0}</strong></span>
                  <span>Timeouts: <strong className="font-medium text-ink tabular-nums">{stats?.errorDistribution?.LLM_TIMEOUT ?? stats?.errorDistribution?.NETWORK ?? 0}</strong></span>
                  <span>Parse Errors: <strong className="font-medium text-ink tabular-nums">{stats?.errorDistribution?.PARSE_FAILURE ?? 0}</strong></span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 sm:px-8 py-10">
        <ul className="divide-y divide-hairline">
          {jobs.map((j) => (
            <li key={j.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-6 py-4">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-muted">
                {j.source}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <p className="text-[15px] font-medium text-ink">{j.role}</p>
                  <span className="text-[13px] text-ink-muted">· {j.company}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  {j.location} · {j.scrapedRelative}
                  {j.filteredReason && <> · <span className="italic">{j.filteredReason}</span></>}
                </p>
              </div>
              <div className="text-[12px]">
                {j.shortlistedAs ? (
                  <Link
                    to="/opportunity/$jobHash"
                    params={{ jobHash: j.shortlistedAs }}
                    className="rounded-full border border-decision-pursue/40 px-3 py-1 text-decision-pursue hover:bg-decision-pursue hover:text-decision-pursue-fg transition-all"
                  >
                    On shortlist →
                  </Link>
                ) : (
                  <span className="rounded-full border border-hairline px-3 py-1 text-ink-muted">Filtered</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function Meta({ label, value, tint = "text-ink" }: { label: string; value: number; tint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">{label}</span>
      <span className={`text-[15px] font-medium tabular-nums ${tint}`}>{value}</span>
    </div>
  );
}

function PipelineStage({ 
  label, 
  value, 
  sub, 
  active = false, 
  tint = "text-ink" 
}: { 
  label: string; 
  value: number; 
  sub: string; 
  active?: boolean; 
  tint?: string; 
}) {
  return (
    <div className="flex-1 text-center">
      <p className="text-[11px] font-mono uppercase tracking-wider text-ink-muted mb-1">{label}</p>
      <div className="flex items-baseline justify-center gap-1">
        <span className={`text-2xl font-medium tabular-nums ${tint} ${active ? "animate-pulse text-decision-pursue" : ""}`}>
          {value}
        </span>
      </div>
      <p className="text-[10px] text-ink-muted/80 truncate mt-0.5">{sub}</p>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">{label}</p>
      <p className="text-[14px] font-medium text-ink mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-[9px] text-ink-muted tracking-tight truncate mt-0.5">{sub}</p>}
    </div>
  );
}