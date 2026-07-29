import { createFileRoute, Link } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { useDecisions, type DecisionRecord } from "../lib/decisions-store";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { getOpportunitiesFn } from "../lib/intelligence/opportunity-server";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Your decisions — RADAR" },
      { name: "description", content: "Every shortlist call you've made — pursued, considered, or passed." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn()
    };
  },
  component: DecisionsPage,
});

type Row = {
  jobHash: string;
  record: DecisionRecord;
  role: string;
  company: string;
  location: string;
  scrapedFrom: "LinkedIn" | "Naukri" | "Indeed";
  applyUrl: string;
};

function DecisionsPage() {
  const { decisions, undo, clear, hydrated } = useDecisions();
  const { opportunitiesList } = Route.useLoaderData();

  const rows: Row[] = Object.entries(decisions)
    .map(([jobHash, record]) => {
      const o = opportunitiesList.find(opp => opp.jobHash === jobHash);
      if (!o) return null;
      return {
        jobHash,
        record,
        role: o.role,
        company: o.company,
        location: o.location,
        scrapedFrom: o.scrapedFrom,
        applyUrl: applyUrlFor(o),
      };
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.record.at - a.record.at);

  const groups: Record<DecisionVerb, Row[]> = {
    PURSUE: rows.filter((r) => r.record.verb === "PURSUE"),
    CONSIDER: rows.filter((r) => r.record.verb === "CONSIDER"),
    PASS: rows.filter((r) => r.record.verb === "PASS"),
    NOT_EVALUABLE: rows.filter((r) => r.record.verb === "NOT_EVALUABLE"),
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <section className="mx-auto max-w-4xl px-4 sm:px-8 pb-10 pt-14">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[38px] font-medium leading-[1.05] tracking-[-0.025em] text-ink">Your decisions.</h1>
          {rows.length > 0 && (
            <button
               type="button"
               onClick={() => {
                 if (confirm("Clear all decisions? This can't be undone.")) clear();
               }}
               className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-ink-muted hover:text-ink transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-muted">
          {rows.length === 0
            ? "No calls made yet. Swipe a brief on the shortlist to add it here."
            : `${rows.length} call${rows.length === 1 ? "" : "s"} on record. Undo to put a brief back on the shortlist.`}
        </p>
        <div className="mt-6 flex gap-8 text-[13px] text-ink-muted">
          <Stat label="Pursued" value={groups.PURSUE.length} tint="text-decision-pursue" />
          <Stat label="Considered" value={groups.CONSIDER.length} tint="text-decision-consider" />
          <Stat label="Passed" value={groups.PASS.length} />
          <Stat label="Not Evaluable" value={groups.NOT_EVALUABLE.length} />
        </div>
      </section>

      <main className="mx-auto max-w-4xl px-4 sm:px-8 pb-24">
        {!hydrated ? (
          <p className="pt-10 text-[13px] text-ink-muted">Loading…</p>
        ) : (
          (["PURSUE", "CONSIDER", "PASS", "NOT_EVALUABLE"] as const).map((verb) => (
            <Group
              key={verb}
              verb={verb}
              rows={groups[verb]}
              onUndo={(jobHash) => undo(jobHash)}
            />
          ))
        )}
      </main>
    </div>
  );
}

function Group({
  verb,
  rows,
  onUndo,
}: {
  verb: DecisionVerb;
  rows: Row[];
  onUndo: (jobHash: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 first:mt-0">
      <div className="flex items-baseline gap-3 border-b border-hairline pb-3">
        <DecisionBadge verb={verb} size="sm" />
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          {rows.length} {rows.length === 1 ? "brief" : "briefs"}
        </span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.jobHash} className="border-b border-hairline">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <Link
                    to="/opportunity/$jobHash"
                    params={{ jobHash: r.jobHash }}
                    className="truncate text-[16px] font-medium tracking-[-0.01em] text-ink hover:underline"
                  >
                    {r.role}
                  </Link>
                  <span className="text-[13px] text-ink-muted">{r.company}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  {r.location} · {r.scrapedFrom} · {relTime(r.record.at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {verb === "PURSUE" && (
                  <a
                    href={r.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm border border-decision-pursue bg-decision-pursue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-decision-pursue-fg hover:opacity-90"
                  >
                    Apply ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => onUndo(r.jobHash)}
                  className="rounded-sm border border-hairline px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted hover:bg-muted hover:text-ink"
                >
                  Undo
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, tint = "text-ink" }: { label: string; value: number; tint?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[17px] font-medium tabular-nums ${tint}`}>{value}</span>
      <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">{label}</span>
    </div>
  );
}

function relTime(at: number) {
  const diff = Date.now() - at;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
