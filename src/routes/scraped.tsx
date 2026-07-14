import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getScrapedJobs, getScraperCounts } from "../data/scraped-jobs";

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

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    window.addEventListener("radar:opportunities", onChange);
    return () => window.removeEventListener("radar:opportunities", onChange);
  }, []);

  const c = getScraperCounts();
  const jobs = getScrapedJobs();

  return (
    <div className="min-h-screen bg-background text-ink">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-8 py-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-ink-muted">RADAR</span>
            <span className="text-ink-muted">/</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">Scraped feed</span>
          </div>
          <Link to="/" className="text-[13px] text-ink-muted hover:text-ink">← Shortlist</Link>
        </div>
      </header>

      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 py-12">
          <h1 className="text-3xl font-medium tracking-tight text-ink">Scraped feed</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
            {c.total} roles pulled from LinkedIn, Naukri, and Indeed in the last 10 days. RADAR promotes {c.shortlisted} to the shortlist and filters {c.filtered} before building a brief.
          </p>
          <div className="mt-6 flex flex-wrap gap-6 text-[13px]">
            <Meta label="LinkedIn" value={c.bySource.LinkedIn} />
            <Meta label="Naukri" value={c.bySource.Naukri} />
            <Meta label="Indeed" value={c.bySource.Indeed} />
            <Meta label="Shortlisted" value={c.shortlisted} tint="text-decision-pursue" />
            <Meta label="Filtered" value={c.filtered} tint="text-ink-muted" />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-8 py-10">
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
                    className="rounded-full border border-decision-pursue/40 px-3 py-1 text-decision-pursue hover:bg-decision-pursue hover:text-decision-pursue-fg"
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