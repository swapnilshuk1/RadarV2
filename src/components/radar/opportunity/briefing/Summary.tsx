import { Link } from "@tanstack/react-router";

interface SummaryProps {
  o: any;
  brief: any;
  currentVerdict: string;
  currentIndex: number;
  totalCount: number;
}

export function Summary({
  o,
  brief,
  currentVerdict,
  currentIndex,
  totalCount,
}: SummaryProps) {
  return (
    <>
      {/* HEADER TITLE BLOCK - Scaled proportionately */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-[1180px] px-5 py-6">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
              ← Shortlist
            </Link>
            <span className="label-mono font-normal text-muted-foreground">
              Brief {String(currentIndex).padStart(2, "0")}/{totalCount}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className={`label-mono rounded-[3px] px-1.5 py-[2px] leading-none uppercase font-normal text-[10px] ${
              currentVerdict === "PURSUE"
                ? "bg-signal text-white"
                : currentVerdict === "CONSIDER"
                ? "bg-caution text-white"
                : "bg-muted text-muted-foreground"
            }`}>
              {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
            </span>
            <span className="label-mono font-normal text-[10px]">Executive Briefing</span>
          </div>

          <h1 className="mt-3 font-display text-3xl leading-[1.1] tracking-tight text-foreground font-normal">
            {o.role} mandate at {o.company}
          </h1>
        </div>
      </header>

      {/* EXECUTIVE SUMMARY TRADE-OFF CARD */}
      <section className="border-b border-border bg-surface-raised py-6">
        <div className="mx-auto max-w-[1180px] px-5">
          <p className="font-display text-2xl leading-snug text-foreground font-normal">
            {brief.oneMinuteTLDR.bottomLine}
          </p>
          <p className="mt-2 text-xs text-foreground/90 font-mono border-l-2 border-primary pl-2.5 leading-relaxed">
            {brief.verdictGuidance.actionNotice}
          </p>

          <div className="mt-5 memo-card p-4 space-y-4 bg-background border border-border/80">
            <div>
              <p className="label-mono text-signal font-semibold text-[10px] tracking-wider">Opportunity</p>
              <ul className="mt-1.5 space-y-1.5 pl-1.5 text-xs">
                {brief.oneMinuteTLDR.whyPursue.slice(0, 3).map((item: string, i: number) => (
                  <li key={i} className="leading-relaxed text-foreground font-normal">• {item}</li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="label-mono text-caution font-semibold text-[10px] tracking-wider">Validate</p>
              <ul className="mt-1.5 space-y-1.5 pl-1.5 text-xs">
                {brief.oneMinuteTLDR.watchFor.slice(0, 3).map((item: string, i: number) => (
                  <li key={i} className="leading-relaxed text-foreground/90 font-normal">• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* EXECUTIVE OPINION & PARTNER VOICE */}
      <section className="border-b border-border py-6">
        <div className="mx-auto max-w-[1180px] px-5 space-y-4">
          <div className="memo-opinion-box p-4 my-0 space-y-2 border border-border/80 bg-background/50">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="label-mono text-[9px] uppercase tracking-wider text-primary font-semibold">Executive Opinion</span>
              <span className="label-mono text-[9px] text-muted-foreground">Advisory Lead</span>
            </div>
            <p className="font-display text-base leading-relaxed text-foreground font-normal">
              {brief.executiveOpinion || "Evaluating executive alignment..."}
            </p>
          </div>

          <div className="py-3 border-y border-border/40">
            <div className="border-l-2 border-primary pl-4 py-0.5 space-y-1">
              <span className="label-mono text-[9px] uppercase tracking-wider text-primary font-semibold">Partner Observation</span>
              <p className="text-base italic font-serif leading-relaxed text-foreground font-normal">
                “The title is less important than the operating latitude. If the commercial mandate proves genuine, this role is materially stronger than its title suggests.”
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
