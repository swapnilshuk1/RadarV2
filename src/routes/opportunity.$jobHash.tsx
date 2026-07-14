import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { type DimensionResult } from "../data/opportunity-fixtures";
import { OpportunityProvider } from "../lib/intelligence/opportunity-provider";
import { candidateProfile } from "../data/candidate-profile";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { PersonalizedRationale } from "../components/radar/PersonalizedRationale";
import { HeadspaceMatrix } from "../components/radar/HeadspaceMatrix";
import { DimensionBreakdown } from "../components/radar/DimensionBreakdown";
import { assertClean } from "../lib/radar-lint";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: ({ params }) => {
    const opportunity = OpportunityProvider.get(params.jobHash);
    if (!opportunity) throw notFound();
    const neighbors = OpportunityProvider.neighbours(params.jobHash);
    return { opportunity, neighbors };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Brief unavailable — RADAR" }, { name: "robots", content: "noindex" }] };
    }
    const o = loaderData.opportunity;
    return {
      meta: [
        { title: `${o.decision} · ${o.role} — RADAR` },
        { name: "description", content: o.recommendation },
        { property: "og:title", content: `${o.decision} · ${o.role} at ${o.company}` },
        { property: "og:description", content: o.recommendation },
      ],
    };
  },
  component: Brief,
});

function Brief() {
  const { opportunity, neighbors } = Route.useLoaderData();
  const o = opportunity;
  const primary = o.primaryConcern
    ? o.dimensions.find((d: DimensionResult) => d.key === o.primaryConcern!.dimension)
    : undefined;

  assertClean(`opportunity:${o.jobHash}`, o.recommendation, ...o.positioning);

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-8 py-6">
          <Link to="/" className="font-mono text-[11px] uppercase tracking-[0.24em] text-ink-muted hover:text-ink">
            ← Shortlist
          </Link>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">
            {candidateProfile.identity.name} · Advisory brief
          </span>
        </div>
      </header>

      {/* Section 1 — RADAR Recommendation */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 pb-16 pt-12">
          <div className="flex flex-wrap items-center gap-3">
            <DecisionBadge verb={o.decision} size="lg" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
              {o.company} · {o.location}
            </span>
            <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">{o.postedRelative}</span>
          </div>
          <p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.28em] text-brass">RADAR Recommendation</p>
          <h1 className="mt-3 font-serif text-6xl leading-[1.02] tracking-tight text-ink">{o.role}</h1>
          <p className="mt-8 max-w-3xl font-serif text-[24px] leading-snug text-ink">
            {o.recommendation}
          </p>
          {o.whyNow && (
            <div className="mt-8 max-w-3xl border-l-2 border-brass/70 pl-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-brass">Why now</p>
              <p className="mt-2 font-serif text-[19px] leading-snug text-ink">{o.whyNow}</p>
            </div>
          )}
        </div>
      </section>

      {/* Section 2 — Why You're Well Positioned */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="02" title="Why you&rsquo;re well positioned" question="Why me?" />
          <div className="mt-8 max-w-3xl">
            <PersonalizedRationale lines={o.positioning} />
          </div>
        </div>
      </section>

      {/* Section 3 & 4 — Evidence + Primary Concern */}
      <section className="border-b border-hairline">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-14 px-8 py-14 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <SectionHeader eyebrow="03" title="Evidence from your career" question="Prove it." />
            {o.primaryProof ? (
              <>
                <div className="mt-8 border-l-2 border-brass pl-5">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-brass">Primary proof</p>
                  <p className="mt-2 font-serif text-[22px] leading-snug text-ink">{o.primaryProof.headline}</p>
                  <p className="mt-2 text-[14.5px] leading-snug text-ink-muted">{o.primaryProof.detail}</p>
                </div>
                <p className="mt-8 font-mono text-[10.5px] uppercase tracking-[0.24em] text-ink-muted">Supporting evidence</p>
                <ul className="mt-3 space-y-2.5">
                  {candidateProfile.experience.achievements.slice(0, 3).map((a: string, i: number) => (
                    <li key={i} className="flex gap-3 pl-1">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-muted/70" />
                      <p className="text-[13.5px] leading-snug text-ink-muted">{a}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <ul className="mt-8 space-y-4">
                {candidateProfile.experience.achievements.slice(0, 4).map((a: string, i: number) => (
                  <li key={i} className="flex gap-3 border-l-2 border-brass/60 pl-4">
                    <p className="text-[15px] leading-snug text-ink">{a}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {primary && o.primaryConcern ? (
            <aside>
              <SectionHeader eyebrow="04" title="Primary hiring concern" question="What is my biggest roadblock?" />
              <div className="mt-8 border border-evidence-contradicted/40 bg-card p-5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-evidence-contradicted">
                  {primary.label} · {primary.bucket}
                </p>
                <blockquote className="mt-3 font-serif italic text-[19px] leading-snug text-ink">
                  “{o.primaryConcern.jdQuote}”
                </blockquote>
                <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                  A single blocker, quoted verbatim from the job description. RADAR does not fragment concerns into lists.
                </p>
              </div>
            </aside>
          ) : (
            <aside className="border-l border-hairline pl-6 self-start">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Hiring risk</p>
              <p className="mt-2 text-[14px] leading-snug text-ink-muted">
                {o.hiringRisk}
              </p>
            </aside>
          )}
        </div>
      </section>

      {/* Section 5 — Headspace Investment */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="05" title="Headspace investment" question="What should I do next?" />
          <div className="mt-8 max-w-3xl">
            {o.headspaceInvestment ? (
              <div className="space-y-8">
                <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-hairline pb-5">
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-ink-muted">Estimated investment</p>
                    <p className="mt-1 font-serif text-[26px] leading-tight text-ink">
                      {o.headspaceInvestment.estimateHours}
                    </p>
                    <p className="text-[12.5px] text-ink-muted">{o.headspaceInvestment.window}</p>
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-brass">Highest-leverage action</p>
                  <p className="mt-2 font-serif text-[19px] leading-snug text-ink">
                    {o.headspaceInvestment.leverage}
                  </p>
                </div>
                {o.headspaceInvestment.optional && o.headspaceInvestment.optional.length > 0 && (
                  <div>
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-ink-muted">Optional</p>
                    <ul className="mt-2 space-y-1.5">
                      {o.headspaceInvestment.optional.map((op: string, i: number) => (
                        <li key={i} className="text-[14px] leading-snug text-ink-muted">— {op}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <HeadspaceMatrix items={o.headspace} />
            )}
          </div>
        </div>
      </section>

      {/* Section 6 — Why RADAR Reached This Recommendation */}
      <section>
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="06" title="Evidence behind this recommendation" question="How does this align with your experience?" />
          <div className="mt-8">
            <DimensionBreakdown dimensions={o.dimensions} />
          </div>
          {o.alternativePath && (
            <div className="mt-12 border-t border-hairline pt-8 max-w-3xl">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-brass">Alternative paths considered</p>
              <p className="mt-2 font-serif text-[16px] leading-relaxed text-ink-muted">
                {o.alternativePath}
              </p>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto grid max-w-5xl grid-cols-3 items-center gap-4 px-8 py-6 text-[12.5px] text-ink-muted">
          {neighbors.prev ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.prev.jobHash }} className="justify-self-start hover:text-ink">
              ← {neighbors.prev.role}
            </Link>
          ) : <span />}
          <Link to="/" className="justify-self-center hover:text-ink">Shortlist</Link>
          {neighbors.next ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next.jobHash }} className="justify-self-end hover:text-ink">
              {neighbors.next.role} →
            </Link>
          ) : <span />}
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({ eyebrow, title, question }: { eyebrow: string; title: string; question: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-brass">§ {eyebrow}</span>
      <div>
        <h2 className="font-serif text-3xl leading-tight tracking-tight text-ink" dangerouslySetInnerHTML={{ __html: title }} />
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.24em] text-ink-muted">{question}</p>
      </div>
    </div>
  );
}
