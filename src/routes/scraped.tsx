import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getAcquisitionFeedFn } from '@/acquisition/feed';
import type { AcquisitionFeedRow, AcquisitionFeedState } from '@/acquisition/contracts';

export const Route = createFileRoute('/scraped')({
  loader: ({ location }) => {
    const raw = location.search as {
      offset?: unknown;
      tenantId?: unknown;
      personId?: unknown;
    };
    const deps = {
      offset: Math.max(0, Number(raw.offset) || 0),
      tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : undefined,
      personId: typeof raw.personId === 'string' ? raw.personId : undefined,
    };
    if (Boolean(deps.tenantId) !== Boolean(deps.personId)) {
      throw new Error('CANDIDATE_SCOPE_INCOMPLETE');
    }
    return getAcquisitionFeedFn({ data: deps });
  },
  head: () => ({
    meta: [
      { title: 'Scraped jobs - RADAR' },
      { name: 'description', content: 'Every captured role and its current analysis status.' },
    ],
  }),
  component: ScrapedFeed,
});

const labels: Record<AcquisitionFeedState, string> = {
  NOT_PURSUED: 'Evaluated · not shortlisted',
  READY: 'Dossier ready',
  PREPARING: 'Preparing dossier',
  PROCESSING: 'Analysis in progress',
  WAITING: 'Awaiting processing',
  NEEDS_ATTENTION: 'Needs attention',
  OUTSIDE_SEARCH: 'Outside your search',
};

function ScrapedFeed() {
  const { rows, counts, total, unadmittedCaptures, nextOffset } = Route.useLoaderData();
  const { offset = 0, tenantId, personId } = Route.useSearch() as {
    offset?: number;
    tenantId?: string;
    personId?: string;
  };
  const scope = { tenantId, personId };
  const router = useRouter();

  const [selectedState, setSelectedState] = useState<AcquisitionFeedState | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void router.invalidate();
    }, 15_000);
    return () => clearInterval(timer);
  }, [router]);

  const displayedRows = selectedState ? rows.filter((r) => r.state === selectedState) : rows;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">Scraped jobs</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {total} roles in your active search. Click any category tile to filter roles or open an
          opportunity to inspect its full decision log.
        </p>
      </header>

      {unadmittedCaptures > 0 && (
        <p role="status" className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200">
          {unadmittedCaptures} additional source captures could not be admitted to this search plan. Their
          capture records are retained for recovery.
        </p>
      )}

      {/* Interactive Metric Tiles */}
      <section className="my-8" aria-label="Status filter tiles">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          {(Object.keys(labels) as AcquisitionFeedState[]).map((state) => {
            const count = counts.find((row) => row.state === state)?.count || 0;
            const isSelected = selectedState === state;

            return (
              <button
                key={state}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedState((curr) => (curr === state ? null : state))}
                className={`relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs'
                    : 'border-border bg-background hover:border-foreground/30 hover:bg-muted/40'
                } ${count === 0 ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <div className="text-2xl font-semibold tabular-nums text-foreground">{count}</div>
                <div className="mt-2 text-xs leading-snug text-muted-foreground font-medium">
                  {labels[state]}
                </div>
                {isSelected && (
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* Active Filter Bar */}
        {selectedState && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-border/80 bg-muted/30 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">
              Showing <strong className="text-foreground">{displayedRows.length}</strong> of {rows.length} roles filtered by{' '}
              <strong className="text-foreground">{labels[selectedState]}</strong>
            </span>
            <button
              type="button"
              onClick={() => setSelectedState(null)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Show all ({rows.length})
            </button>
          </div>
        )}
      </section>

      {/* Opportunities List */}
      <section aria-label="Captured opportunities list">
        <ul className="divide-y divide-border">
          {displayedRows.map((row) => (
            <li
              key={row.id + ':' + row.version}
              className="flex flex-wrap items-center justify-between gap-4 py-5 hover:bg-muted/10 transition-colors -mx-2 px-2 rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {row.source}
                </p>
                <Link
                  to="/scraped/$jobHash"
                  params={{ jobHash: row.jobHash }}
                  search={scope}
                  className="mt-1 block font-medium text-foreground hover:text-primary hover:underline transition-colors"
                >
                  {row.role}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {row.company}
                  {row.location ? ' · ' + row.location : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {row.state === 'READY' ? (
                  <>
                    <Link
                      to="/scraped/$jobHash"
                      params={{ jobHash: row.jobHash }}
                      search={scope}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      Decision log
                    </Link>
                    <Link
                      to="/opportunity/$jobHash"
                      params={{ jobHash: row.jobHash }}
                      search={scope}
                      className="rounded-md border border-foreground bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-foreground/90 transition-colors shadow-xs"
                    >
                      {row.decision} · View dossier
                    </Link>
                  </>
                ) : (
                  <Link
                    to="/scraped/$jobHash"
                    params={{ jobHash: row.jobHash }}
                    search={scope}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>{labels[row.state]}</span>
                    <span aria-hidden="true" className="text-muted-foreground">&rarr;</span>
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>

        {!displayedRows.length && (
          <div className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {selectedState
                ? `No roles matching "${labels[selectedState]}" on this page.`
                : 'No captured roles in this search yet.'}
            </p>
            {selectedState && (
              <button
                type="button"
                onClick={() => setSelectedState(null)}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                Clear filter to view all roles
              </button>
            )}
          </div>
        )}
      </section>

      {/* Pagination */}
      <nav aria-label="Scraped jobs pages" className="mt-8 flex justify-between border-t border-border pt-4">
        {offset > 0 ? (
          <Link
            to="/scraped"
            search={{ ...scope, offset: Math.max(0, offset - 100) }}
            className="text-sm text-foreground hover:underline"
          >
            &larr; Previous
          </Link>
        ) : (
          <span />
        )}
        {nextOffset !== null && (
          <Link
            to="/scraped"
            search={{ ...scope, offset: nextOffset }}
            className="text-sm text-foreground hover:underline"
          >
            Next &rarr;
          </Link>
        )}
      </nav>
    </main>
  );
}
