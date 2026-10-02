import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { acquisitionNavigationSearch } from "@/acquisition/navigation";

import { getScrapedJobDetailFn } from "@/acquisition/detail-server";

import type { AcquisitionFeedState } from "@/acquisition/contracts";

export const Route = createFileRoute("/scraped_/$jobHash")({
  validateSearch: acquisitionNavigationSearch,

  loaderDeps: ({ search }) => ({ ...search }),

  loader: async ({ params, deps }) => {
    const detail = await getScrapedJobDetailFn({ data: { jobHash: params.jobHash, ...deps } });

    if (!detail) throw notFound();

    return { detail };
  },

  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.detail
          ? `${loaderData.detail.role} · Decision Log — RADAR`
          : "Scraped Job Detail — RADAR",
      },
    ],
  }),

  component: ScrapedJobDetailView,
});

const STATE_CONFIG: Record<
  AcquisitionFeedState,
  { label: string; badgeClass: string; cardBorder: string; desc: string }
> = {
  READY: {
    label: "Dossier ready",

    badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",

    cardBorder: "border-emerald-500/30",

    desc: "Evaluation is complete and the executive memo dossier is ready for review.",
  },

  NOT_PURSUED: {
    label: "Evaluated · not shortlisted",

    badgeClass: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20",

    cardBorder: "border-zinc-500/30",

    desc: "Evaluation concluded PASS. The recorded requirements and decision hinges explain the decision below.",
  },

  OUTSIDE_SEARCH: {
    label: "Outside your search",

    badgeClass: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",

    cardBorder: "border-zinc-500/20",

    desc: "Excluded by the intake attention gate based on role family, seniority, or location boundaries.",
  },

  NEEDS_ATTENTION: {
    label: "Needs attention",

    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",

    cardBorder: "border-amber-500/30",

    desc: "Capture or processing encountered an anomaly requiring inspection or recovery.",
  },

  PROCESSING: {
    label: "Analysis in progress",

    badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",

    cardBorder: "border-sky-500/30",

    desc: "The staged intelligence model is actively analyzing role criteria and candidate qualifications.",
  },

  PREPARING: {
    label: "Preparing dossier",

    badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",

    cardBorder: "border-sky-500/30",

    desc: "Staged evaluation is complete; rich executive memo presentation is being prepared.",
  },

  WAITING: {
    label: "Awaiting processing",

    badgeClass: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",

    cardBorder: "border-zinc-500/20",

    desc: "Captured and admitted to search plan. Queued for worker evaluation dispatch.",
  },
};

function ScrapedJobDetailView() {
  const { detail } = Route.useLoaderData();

  const search = Route.useSearch();

  const scope = { tenantId: search.tenantId, personId: search.personId };

  const stateCfg = STATE_CONFIG[detail.state] || STATE_CONFIG.WAITING;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      {/* Back breadcrumb */}

      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          to="/scraped"

          search={{ ...scope, offset: search.offset, state: search.state }}

          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to Scraped jobs
        </Link>
      </nav>

      {/* Role Header */}

      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {detail.source}
            </span>

            {detail.postedAt && (
              <>
                <span className="text-xs text-muted-foreground/60">&bull;</span>

                <span className="text-xs text-muted-foreground">Posted {detail.postedAt}</span>
              </>
            )}
          </div>

          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateCfg.badgeClass}`}
          >
            {stateCfg.label}
          </span>
        </div>

        <h1 className="font-serif text-3xl sm:text-4xl text-foreground font-normal tracking-tight">
          {detail.role}
        </h1>

        <p className="mt-2 text-lg text-muted-foreground">
          {detail.company}

          {detail.location ? ` · ${detail.location}` : ""}
        </p>

        {/* Action Bar */}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {detail.state === "READY" && (
            <Link
              to="/opportunity/$jobHash"

              params={{ jobHash: detail.jobHash }}

              search={scope}

              className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-colors shadow-xs"
            >
              View Executive Memo Dossier
              <span aria-hidden="true">&rarr;</span>
            </Link>
          )}

          {(detail.applyUrl || detail.canonicalUrl) && (
            <a
              href={detail.applyUrl || detail.canonicalUrl || "#"}

              target="_blank"

              rel="noopener noreferrer"

              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              Original Job Posting
              <span aria-hidden="true" className="text-xs">
                &nearr;
              </span>
            </a>
          )}
        </div>
      </header>

      {/* Status & Verdict Overview Banner */}

      <section
        className={`mt-8 rounded-xl border p-5 ${stateCfg.cardBorder} bg-muted/20 space-y-2`}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Current Analysis State
          </h2>

          {detail.decision && (
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded border border-border bg-background">
              VERDICT: {detail.decision}
            </span>
          )}
        </div>

        <p className="text-base font-medium text-foreground">{stateCfg.desc}</p>

        <p className="text-sm text-muted-foreground">{detail.diagnostics.details}</p>
      </section>

      {/* DECISION LOG SECTION */}

      <section className="mt-10 space-y-8" aria-label="Decision log">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Decision Log</h2>

          <p className="text-sm text-muted-foreground mt-1">
            Recorded intake and intelligence decisions for this opportunity version in your current
            search context.
          </p>
        </div>

        {/* 1. Intake Attention Gate */}

        {detail.attentionGate && (
          <div className="rounded-xl border border-border bg-background p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Gate 1
                </span>

                <h3 className="font-medium text-foreground">Search Intake & Attention Gate</h3>
              </div>

              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-mono ${
                  detail.attentionGate.decision === "CANDIDATE"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {detail.attentionGate.decision === "CANDIDATE"
                  ? "ADMITTED (CANDIDATE)"
                  : "EXCLUDED (NOT CANDIDATE)"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Eligibility Classification</p>

                <p className="mt-1 font-mono font-medium text-foreground">
                  {detail.attentionGate.eligibility || "STANDARD"}
                </p>
              </div>

              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Location Scope & Evidence</p>

                <p className="mt-1 text-foreground">
                  {detail.attentionGate.locationPolicy || "No location policy recorded"}

                  {detail.attentionGate.locationEvidence
                    ? ` · ${detail.attentionGate.locationEvidence}`
                    : ""}
                </p>
              </div>
            </div>

            {/* Explanations */}

            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Gate Determinations & Reason Codes
              </p>

              {detail.attentionGate.explanations.length > 0 ? (
                <ul className="space-y-2.5">
                  {detail.attentionGate.explanations.map((exp) => (
                    <li
                      key={exp.code}

                      className="flex items-start gap-3 rounded-lg border border-border/60 p-3 text-sm bg-muted/10"
                    >
                      <span
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          exp.impact === "match"
                            ? "bg-emerald-500"
                            : exp.impact === "review"
                              ? "bg-amber-500"
                              : "bg-zinc-400"
                        }`}
                      />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{exp.title}</p>

                          <span className="font-mono text-xs text-muted-foreground">
                            [{exp.code}]
                          </span>
                        </div>

                        <p className="text-sm text-muted-foreground mt-0.5">{exp.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No reason codes were recorded for this intake decision.
                </p>
              )}
            </div>
          </div>
        )}

        {/* 2. Intelligence Evaluation & Screening Breakdown */}

        {detail.evaluation ? (
          <div className="rounded-xl border border-border bg-background p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Gate 2
                </span>

                <h3 className="font-medium text-foreground">Intelligence Evaluation & Screening</h3>
              </div>

              <div className="flex items-center gap-2">
                {detail.evaluation.screeningViability && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded border border-border text-muted-foreground">
                    Viability: {detail.evaluation.screeningViability}
                  </span>
                )}

                {detail.evaluation.verdict && (
                  <span
                    className={`text-xs font-mono font-semibold px-2.5 py-0.5 rounded ${
                      detail.evaluation.verdict === "PURSUE"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                        : detail.evaluation.verdict === "CONSIDER"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                          : "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border border-zinc-500/20"
                    }`}
                  >
                    {detail.evaluation.verdict}
                  </span>
                )}
              </div>
            </div>

            {/* Rationale or Blocked Reason */}

            {(detail.evaluation.rationale || detail.evaluation.blockedReason) && (
              <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-1.5">
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Evaluation Thesis & Rationale
                </p>

                <p className="text-sm leading-relaxed text-foreground">
                  {detail.evaluation.rationale || detail.evaluation.blockedReason}
                </p>
              </div>
            )}

            {/* Screening Drivers & Requirements Breakdown */}
            {detail.evaluation.screeningConstraint && (
              <p className="text-sm text-muted-foreground">
                <strong>Recorded screening constraint:</strong>{" "}
                {detail.evaluation.screeningConstraint.replace(/_/g, " ")}
              </p>
            )}
            {!!detail.evaluation.decisionConditions?.length && (
              <div className="space-y-2 text-sm">
                <h4 className="font-medium">Decision hinges</h4>
                {detail.evaluation.decisionConditions.map((condition, index) => (
                  <p key={index}>
                    <strong>{condition.subject}:</strong> {condition.detail}
                  </p>
                ))}
              </div>
            )}

            {detail.evaluation.screeningDrivers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Role Requirements & Evidence Mapping
                  </p>

                  <span className="text-xs text-muted-foreground">
                    {detail.evaluation.screeningDrivers.length} requirements checked
                  </span>
                </div>

                <ul className="divide-y divide-border/60 rounded-lg border border-border/60 overflow-hidden">
                  {detail.evaluation.screeningDrivers.map((driver) => {
                    const isSatisfied = driver.status === "DIRECT";

                    const isAdjacent = driver.status === "ADJACENT";

                    const isMissing = driver.status === "NOT_EVIDENCED";

                    return (
                      <li
                        key={driver.id || driver.requirement}
                        className="p-4 space-y-2 bg-background hover:bg-muted/10 transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground text-sm">
                            {driver.requirement}
                          </p>

                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-muted/50">
                              {driver.strength} ·{" "}
                              {driver.screeningGate ? "SCREENING GATE" : "ROLE REQUIREMENT"}
                            </span>

                            <span
                              className={`text-xs font-mono font-medium px-2 py-0.5 rounded ${
                                isSatisfied
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : isAdjacent
                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    : isMissing
                                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                      : "bg-zinc-500/10 text-zinc-600"
                              }`}
                            >
                              {driver.status.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>

                        {driver.reasoning && (
                          <p className="text-xs text-muted-foreground">
                            <strong>Role interpretation:</strong> {driver.reasoning}
                          </p>
                        )}

                        {driver.screeningReasoning && (
                          <p className="text-xs text-muted-foreground">
                            <strong>Screening classification:</strong> {driver.screeningReasoning}
                          </p>
                        )}

                        {driver.mappingReasoning && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            <span className="font-semibold text-foreground/80">
                              Candidate mapping:
                            </span>{" "}
                            {driver.mappingReasoning}
                          </p>
                        )}

                        {[...(driver.roleEvidence || []), ...(driver.candidateEvidence || [])].map(
                          (claim) => (
                            <div
                              key={claim.id}
                              className="rounded border border-border/60 p-2 text-xs"
                            >
                              <p>
                                <strong>
                                  {driver.candidateEvidence?.some(
                                    (candidate) => candidate.id === claim.id,
                                  )
                                    ? "Candidate evidence"
                                    : "Role evidence"}{" "}
                                  · {claim.state}
                                </strong>{" "}
                                {claim.text}
                              </p>

                              {claim.citations.map((citation, index) => (
                                <blockquote
                                  key={index}
                                  className="mt-1 border-l-2 pl-2 text-muted-foreground"
                                >
                                  “{citation.quote}” · {citation.sourceId}
                                </blockquote>
                              ))}
                            </div>
                          ),
                        )}

                        {driver.gapReasoning && (
                          <p className="text-xs text-rose-600/90 dark:text-rose-400/90 leading-relaxed">
                            <span className="font-semibold">Gap Analysis:</span>{" "}
                            {driver.gapReasoning}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">
              Intelligence Evaluation Not Executed
            </p>

            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              {detail.state === "OUTSIDE_SEARCH"
                ? "This position was excluded at the intake attention gate and was not dispatched for full model evaluation."
                : detail.state === "NEEDS_ATTENTION"
                  ? detail.diagnostics.details
                  : "No completed intelligence evaluation is recorded for this opportunity in the current context."}
            </p>
          </div>
        )}

        {/* 3. Pipeline Diagnostics */}

        <div className="rounded-xl border border-border bg-background p-6 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h3 className="font-medium text-foreground text-sm">System Pipeline Audit</h3>

            <span className="font-mono text-xs text-muted-foreground">
              Stage: {detail.diagnostics.stage}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Pipeline State</span>

              <p className="font-medium font-mono text-foreground mt-0.5">{detail.state}</p>
            </div>

            <div>
              <span className="text-muted-foreground">Opportunity Hash</span>

              <p className="font-mono text-muted-foreground mt-0.5 truncate">{detail.jobHash}</p>
            </div>

            <div>
              <span className="text-muted-foreground">Source Capture</span>

              <p className="text-foreground mt-0.5">
                {detail.capturedAt || "Captured via acquisition sync"}
              </p>
            </div>
          </div>

          {detail.diagnostics.recoveryReason && (
            <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <span className="font-semibold">Recovery Attention:</span>{" "}
              {detail.diagnostics.recoveryReason}
            </div>
          )}

          {detail.diagnostics.error && (
            <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200">
              <span className="font-semibold">Pipeline Error:</span> {detail.diagnostics.error}
            </div>
          )}
        </div>
      </section>

      {/* FULL JOB DESCRIPTION SECTION */}

      <section className="mt-12 space-y-4" aria-label="Job description">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-foreground">Captured Job Description</h2>

          <span className="text-xs font-mono text-muted-foreground">
            {detail.description
              ? `${detail.description.length.toLocaleString()} characters`
              : "No text captured"}
          </span>
        </div>

        <div className="rounded-xl border border-border bg-muted/10 p-6">
          {detail.description ? (
            <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90 font-sans max-h-[600px] overflow-y-auto pr-2">
              {detail.description}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No raw job description content was captured for this record.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
