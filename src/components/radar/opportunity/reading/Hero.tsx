import { Link } from "@tanstack/react-router";
import { getFocusTopic } from "@/routes/opportunity.$jobHash";

interface HeroProps {
  o: any;
  brief: any;
  currentVerdict: string;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  readTime?: string;
}

export function Hero({
  o,
  brief,
  currentVerdict,
  currentIndex,
  totalCount,
  jobProj,
  readTime,
}: HeroProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="memo-container py-10">
        {/* Nav Sub-Header */}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
            ← Shortlist
          </Link>
          <span className="label-mono font-normal text-muted-foreground">
            Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
          </span>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[3fr_2fr]">
          {/* Left Column: Strategic Mandate & Core Advisory Thesis */}
          <div className="space-y-6">
            {/* Badges & Verbs */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`label-mono rounded-[3px] px-1.5 py-[3px] leading-none uppercase font-normal ${
                currentVerdict === "PURSUE"
                  ? "bg-signal text-white"
                  : currentVerdict === "CONSIDER"
                  ? "bg-caution text-white"
                  : "bg-muted text-muted-foreground"
              }`}>
                {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
              </span>
              <span className="label-mono font-normal">{brief.fitLabel || 'Executive Fit'}</span>
              <span className="label-mono font-normal">· {brief.evidenceQuality}</span>
              {readTime && <span className="label-mono font-normal">· {readTime}</span>}
            </div>

            <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-foreground font-normal">
              {o.role} mandate at {o.company} focused on {getFocusTopic(o, jobProj)}
            </h1>

            {/* Structured Metadata Strip */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2">
              {o.company && <span className="text-xs text-muted-foreground font-normal">{o.company}</span>}
              {o.location && <span className="text-xs text-muted-foreground font-normal">{o.location}</span>}
              {o.source && <span className="text-xs text-muted-foreground font-normal">via {o.source}</span>}
              {o.compensationBand && <span className="text-xs text-foreground font-medium">{o.compensationBand}</span>}
            </div>

            {/* High-Altitude Strategic Thesis (The Decision Partner's Core Insight) */}
            <div className="border-t border-border pt-5 space-y-3">
              <p className="label-mono text-xs text-primary font-normal uppercase tracking-wider">Executive Advisory Thesis</p>
              <p className="font-serif text-2xl italic leading-relaxed text-foreground font-normal">
                “{brief.executiveOpinion || "Evaluating strategic executive alignment..."}”
              </p>
            </div>
          </div>

          {/* Right Column: Instant Action Card */}
          <div className="memo-card bg-surface-raised p-6 flex flex-col justify-between border border-border">
            <div>
              <div className="flex items-baseline justify-between gap-2 border-b border-border pb-3">
                <span className="label-mono text-primary font-normal">Verdict Overview</span>
                <span className="label-mono font-normal text-muted-foreground">1-Minute TL;DR</span>
              </div>
              
              <p className="mt-4 font-display text-3xl leading-snug text-foreground font-normal">
                {brief.oneMinuteTLDR.bottomLine}
              </p>
              
              <p className="mt-3 text-xs leading-relaxed text-foreground font-mono border-l-2 border-primary pl-3">
                {brief.verdictGuidance.actionNotice}
              </p>

              <div className="mt-5 space-y-4">
                <div className="space-y-1">
                  <p className="label-mono text-signal font-normal tracking-wider">Why this fits</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.whyPursue.slice(0, 2).map((item: string, i: number) => (
                      <li key={i} className="text-xs leading-relaxed text-muted-foreground font-normal">
                        • {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1">
                  <p className="label-mono text-caution font-normal tracking-wider">What to verify</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.watchFor.slice(0, 1).map((item: string, i: number) => (
                      <li key={i} className="text-xs leading-relaxed text-muted-foreground font-normal flex items-start gap-1">
                        <span className="text-caution font-bold">•</span>
                        <span>{item.replace(/^(Strategic|Execution|Market) Risk:\s*/i, '')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
