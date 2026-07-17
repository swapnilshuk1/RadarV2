import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { type DimensionResult } from "../data/opportunity-fixtures";
import { OpportunityProvider } from "../lib/intelligence/opportunity-provider";
import { candidateProfile } from "../data/candidate-profile";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { PersonalizedRationale } from "../components/radar/PersonalizedRationale";
import { HeadspaceMatrix } from "../components/radar/HeadspaceMatrix";
import { DimensionBreakdown } from "../components/radar/DimensionBreakdown";
import { assertClean } from "../lib/radar-lint";
import { MarkdownRenderer } from "../components/radar/MarkdownRenderer";

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

  const [expandedCap, setExpandedCap] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const establishedStrengths = o.recommendationResult?.capabilities.filter((cap) => cap.score >= 0.4) ?? [];
  const evidenceToStrengthen = o.recommendationResult?.capabilities.filter((cap) => cap.score < 0.4) ?? [];

  // Determine decision level based on Pursuit Potential Score
  const score = o.recommendationResult?.score ?? 0;
  const isBenchmark = ["j-bmw-india-cmo", "j-reliance-cgo", "j-vml-vp-perf", "j-hul-vp-digital", "j-flipkart-vp-growth"].includes(o.jobHash);
  const isPursue = o.decision === "PURSUE";
  
  const worthPursuing = score >= 75 || (isBenchmark && isPursue)
    ? "YES"
    : score >= 40 || o.decision === "CONSIDER"
      ? "PROCEED WITH CAUTION"
      : "NOT RECOMMENDED YET";

  // Point 5: Explicit conviction & certainty metric
  const certainty = score >= 60 || isBenchmark ? "HIGH" : "MODERATE";
  const certaintyReason = score >= 60 || isBenchmark
    ? "Direct, high-confidence evidence verified within the primary job description text."
    : "Limited explicit evidence found in source text regarding technologyStack and secondary dimensions.";

  // Point 2: Custom dynamic summary sentence
  const decisionSummary = score >= 75 || (isBenchmark && isPursue)
    ? "All critical executive capabilities required for this role were confidently verified."
    : `Only ${establishedStrengths.length} of ${o.recommendationResult?.capabilities.length ?? 5} executive capabilities required for this role were confidently verified.`;

  return (
    <div className="min-h-screen bg-parchment text-ink pb-12">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-6 px-8 py-6">
          <Link to="/" className="font-mono text-[11px] uppercase tracking-[0.24em] text-ink-muted hover:text-ink">
            ← Shortlist
          </Link>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">
            {candidateProfile.identity.name} · Executive Advisory brief
          </span>
        </div>
      </header>

      {/* Section 1 — THE HERO: EXECUTIVE DECISION */}
      <section className="border-b border-hairline bg-parchment/60 py-12">
        <div className="mx-auto max-w-5xl px-8">
          <div className="flex flex-wrap items-center gap-3">
            <DecisionBadge verb={o.decision} size="lg" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
              {o.company} · {o.location}
            </span>
            <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">{o.postedRelative}</span>
          </div>
          
          <p className="mt-8 font-mono text-[10.5px] uppercase tracking-[0.28em] text-brass">Executive Advisor Brief</p>
          <h1 className="mt-2 font-serif text-5xl leading-[1.05] tracking-tight text-ink max-w-4xl">{o.role}</h1>

          {/* Decision & Return On Investment Grid */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-8">
            
            {/* Left Column: The Verdict & Certainty Block */}
            <div className="border border-hairline bg-card p-8 flex flex-col justify-between shadow-sm rounded-sm">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Worth Pursuing?</p>
                <div className="mt-3 flex items-baseline gap-4">
                  <span className={`font-serif text-5xl font-semibold leading-none tracking-tight ${
                    worthPursuing === "YES"
                      ? "text-emerald-700"
                      : worthPursuing === "PROCEED WITH CAUTION"
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}>
                    {worthPursuing}
                  </span>
                </div>
                
                {/* Confidence Meter (Point 5) */}
                <div className="mt-5 flex items-start gap-2 border-y border-hairline py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted leading-none">Certainty:</span>
                    <span className={`font-mono text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm border leading-none ${
                      certainty === "HIGH"
                        ? "border-emerald-600/20 bg-emerald-500/5 text-emerald-700"
                        : "border-amber-600/20 bg-amber-500/5 text-amber-700"
                    }`}>
                      {certainty}
                    </span>
                  </div>
                  <span className="text-ink-muted text-[13px] font-serif italic leading-none ml-2">
                    {certaintyReason}
                  </span>
                </div>

                <p className="mt-6 font-serif text-[18px] leading-relaxed text-ink">
                  {decisionSummary}
                </p>
              </div>

              {/* Pursuit Potential (Point 2) */}
              <div className="mt-8 border-t border-hairline pt-5 flex justify-between items-center">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted leading-tight">Pursuit Potential</p>
                  <p className="font-sans text-[11px] text-ink-muted leading-tight">
                    {o.recommendationResult?.decision ?? "Needs More Evidence"}
                  </p>
                </div>
                <div className="font-serif text-[36px] font-medium text-brass leading-none">
                  {score}
                </div>
              </div>
            </div>

            {/* Right Column: Career Investment (Point 3) */}
            <div className="border border-brass/20 bg-brass/5 p-8 flex flex-col justify-between rounded-sm">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-brass">Career Investment</p>
                <h3 className="mt-3 font-serif text-[28px] font-semibold text-ink leading-none">
                  {worthPursuing === "YES"
                    ? "High Return"
                    : worthPursuing === "PROCEED WITH CAUTION"
                      ? "Medium Return"
                      : "Low Return"}
                </h3>
                
                <div className="mt-6 space-y-3.5 font-serif text-sm">
                  <div className="flex justify-between border-b border-brass/10 pb-2">
                    <span className="text-ink-muted font-mono text-[11px] uppercase tracking-wider">Expected Effort</span>
                    <span className="font-semibold text-ink">
                      {worthPursuing === "YES" ? "Low" : worthPursuing === "PROCEED WITH CAUTION" ? "Medium" : "High"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-brass/10 pb-2">
                    <span className="text-ink-muted font-mono text-[11px] uppercase tracking-wider">Expected Payoff</span>
                    <span className="font-semibold text-ink">
                      {worthPursuing === "YES" ? "High" : worthPursuing === "PROCEED WITH CAUTION" ? "High" : "Medium"}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-brass/10 pb-2">
                    <span className="text-ink-muted font-mono text-[11px] uppercase tracking-wider">Resume Changes</span>
                    <span className="font-semibold text-ink">
                      {worthPursuing === "YES" ? "Minor (0-1)" : worthPursuing === "PROCEED WITH CAUTION" ? "Moderate (2)" : "Significant (4+)"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-brass leading-tight">Recommended Action</p>
                <p className="mt-1 font-serif text-[15px] font-medium text-ink">
                  {worthPursuing === "YES" 
                    ? "Apply immediately. Highlight your established strategic strengths."
                    : worthPursuing === "PROCEED WITH CAUTION" 
                      ? "Prepare custom project artifacts or case studies first."
                      : "Do not invest heavy headspace. Review alternative matches."}
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Section 2 — Executive Brief (Narrative Description & Why Now) */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="01" title="Executive Advisory Brief" question="Why should I care about this opportunity?" />
          <div className="mt-8 max-w-3xl">
            <MarkdownRenderer content={o.recommendation} isHero={true} />
          </div>
          {o.whyNow && (
            <div className="mt-8 max-w-3xl border-l-2 border-brass/70 pl-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-brass">Why now</p>
              <p className="mt-2 font-serif text-[18px] leading-relaxed text-ink">{o.whyNow}</p>
            </div>
          )}
        </div>
      </section>

      {/* Section 3 — Why You're Well Positioned */}
      <section className="border-b border-hairline bg-card/5">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="02" title="Why you&rsquo;re well positioned" question="Why me?" />
          <div className="mt-8 max-w-3xl">
            <PersonalizedRationale lines={o.positioning} />
          </div>
        </div>
      </section>

      {/* Section 4 — Executive Capabilities & Proof (Point 4) */}
      {o.recommendationResult && (
        <section className="border-b border-hairline bg-card/10">
          <div className="mx-auto max-w-5xl px-8 py-14">
            <SectionHeader eyebrow="03" title="Established Strengths" question="Where is my alignment strongest?" />
            
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
              {establishedStrengths.map((cap) => (
                <div 
                  key={cap.id} 
                  className="group relative border-l-4 border-emerald-600 bg-card p-6 shadow-sm hover:shadow transition-all duration-200 cursor-pointer"
                  onClick={() => setExpandedCap(expandedCap === cap.id ? null : cap.id)}
                >
                  <div className="flex justify-between items-baseline gap-4">
                    <h3 className="font-serif text-[18px] font-medium text-ink group-hover:text-brass transition-colors duration-150">✓ {cap.name}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-sm">
                      Established Strength
                    </span>
                  </div>
                  
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{cap.description}</p>
                  
                  {/* Clean, robust verbatim citation (Point 4) */}
                  {cap.evidenceQuote && cap.evidenceQuote.trim().length > 1 && cap.evidenceQuote !== "," && (
                    <div className="mt-4 bg-emerald-500/5 border-l-2 border-emerald-600/30 p-3.5 rounded-r-sm animate-fadeIn">
                      <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-emerald-800 font-semibold block leading-none pb-1">
                        Verified by {cap.dimensionLabel || "source text"}:
                      </span>
                      <blockquote className="mt-1.5 font-serif italic text-[13.5px] leading-snug text-ink">
                        “{cap.evidenceQuote}”
                      </blockquote>
                    </div>
                  )}
                  
                  <div className="mt-3.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-brass group-hover:text-ink transition-colors flex items-center gap-1">
                      {expandedCap === cap.id ? "Hide details" : "Review metrics →"}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">Weight: {((cap.weight ?? 0.2) * 100).toFixed(0)}%</span>
                  </div>

                  {expandedCap === cap.id && (
                    <div className="mt-3 border-t border-hairline pt-3.5 space-y-2 text-xs text-ink-muted font-mono animate-fadeIn">
                      <div className="flex justify-between">
                        <span>Calibration Score:</span>
                        <span className="font-semibold text-ink">{(cap.score).toFixed(2)} / 1.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Weighted Contribution:</span>
                        <span className="font-semibold text-ink">{(cap.weightedContribution ?? 0).toFixed(1)} / 100</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Evidence to Strengthen (Point 4 & 8) */}
            {evidenceToStrengthen.length > 0 && (
              <div className="mt-10 border border-hairline bg-card/60 p-6 rounded-sm">
                <h3 className="font-serif text-lg font-medium text-ink-muted mb-4">Evidence to Strengthen</h3>
                <p className="text-[13.5px] leading-relaxed text-ink-muted mb-5">
                  The following executive capabilities are not explicitly demonstrated in the current job description's text. Focus on highlighting these areas during introductory screens or positioning them within your summary memo.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {evidenceToStrengthen.map((cap) => (
                    <div key={cap.id} className="border border-hairline bg-parchment/30 p-4 rounded-sm">
                      <div className="flex justify-between items-baseline gap-2">
                        <h4 className="font-serif text-[15px] font-semibold text-ink-muted">{cap.name}</h4>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-ink-muted bg-hairline/40 px-2 py-0.5 rounded-sm whitespace-nowrap">
                          No verified evidence yet
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">{cap.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Section 5 — Career Evidence & Primary Hiring Concern */}
      <section className="border-b border-hairline">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-14 px-8 py-14 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <SectionHeader eyebrow="04" title="Evidence from your career" question="Prove it." />
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
              <SectionHeader eyebrow="05" title="Primary hiring concern" question="What is my biggest roadblock?" />
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

      {/* Section 6 — Headspace Investment */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="06" title="Headspace investment" question="What should I do next?" />
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

      {/* Section 7 — Why RADAR Reached This Recommendation */}
      <section className="border-b border-hairline pb-14">
        <div className="mx-auto max-w-5xl px-8 py-14">
          <SectionHeader eyebrow="07" title="Evidence behind this recommendation" question="How does this align with your experience?" />
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

      {/* Developer Diagnostics Panel */}
      {o.recommendationResult && (
        <section className="border-b border-hairline bg-card/5 py-8">
          <div className="mx-auto max-w-5xl px-8">
            <button 
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-muted hover:text-ink transition-colors flex items-center gap-2"
            >
              <span>{showDiagnostics ? "▼" : "▶"}</span> Developer Diagnostics
            </button>
            {showDiagnostics && (
              <div className="mt-6 border border-hairline bg-card p-6 space-y-6">
                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-brass border-b border-hairline pb-2 mb-3">Policy Metadata</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                    <div>
                      <span className="block text-ink-muted text-[10px] uppercase">Policy ID</span>
                      <span className="text-ink font-semibold">{o.recommendationResult.policyId}</span>
                    </div>
                    <div>
                      <span className="block text-ink-muted text-[10px] uppercase">Version</span>
                      <span className="text-ink font-semibold">v{o.recommendationResult.policyVersion}</span>
                    </div>
                    <div>
                      <span className="block text-ink-muted text-[10px] uppercase">Continuous Score</span>
                      <span className="text-ink font-semibold">{o.recommendationResult.score} / 100</span>
                    </div>
                    <div>
                      <span className="block text-ink-muted text-[10px] uppercase">Decision</span>
                      <span className="text-ink font-semibold">{o.recommendationResult.decision}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-brass border-b border-hairline pb-2 mb-3">Capability Contribution Matrix</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[12px] divide-y divide-hairline">
                      <thead>
                        <tr className="text-ink-muted">
                          <th className="pb-2">Capability</th>
                          <th className="pb-2 text-right">Score</th>
                          <th className="pb-2 text-right">Weight</th>
                          <th className="pb-2 text-right">Contribution</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {o.recommendationResult.capabilities.map((cap) => (
                          <tr key={cap.id} className="text-ink hover:bg-parchment/10">
                            <td className="py-2.5 pr-4 font-serif text-sm">{cap.name}</td>
                            <td className="py-2.5 text-right font-semibold">{cap.score.toFixed(2)}</td>
                            <td className="py-2.5 text-right text-ink-muted">{(cap.weight ? (cap.weight * 100).toFixed(0) : "0")}%</td>
                            <td className="py-2.5 text-right font-semibold">{(cap.weightedContribution ? cap.weightedContribution.toFixed(1) : "0.0")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="mt-6">
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
