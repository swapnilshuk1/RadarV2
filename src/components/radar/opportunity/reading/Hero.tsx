import { Link } from "@tanstack/react-router";
import { getFocusTopic } from "@/routes/opportunity.$jobHash";

interface HeroProps {
  o: any;
  brief: any;
  currentVerdict: string;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
}

export function Hero({
  o,
  brief,
  currentVerdict,
  currentIndex,
  totalCount,
  jobProj,
}: HeroProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto max-w-[1180px] px-8 py-10">
        {/* Nav Sub-Header */}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
            ← Shortlist
          </Link>
          <span className="label-mono font-normal text-muted-foreground">
            Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
          </span>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
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
              <span className="label-mono font-normal">Strong Executive Fit</span>
              <span className="label-mono font-normal">· {brief.evidenceQuality}</span>
              <span className="label-mono font-normal">· 20 minute application</span>
            </div>

            <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-foreground font-normal">
              {o.role} mandate at {o.company} focused on {getFocusTopic(o, jobProj)}
            </h1>

            {/* High-Altitude Strategic Thesis (The Decision Partner's Core Insight) */}
            <div className="border-t border-border/80 pt-5 space-y-3">
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
                <span className="label-mono text-primary font-normal text-[10px]">Verdict Overview</span>
                <span className="label-mono font-normal text-muted-foreground text-[10px]">1-Minute TL;DR</span>
              </div>
              
              <p className="mt-4 font-display text-3xl leading-snug text-foreground font-normal">
                {brief.oneMinuteTLDR.bottomLine}
              </p>
              
              <p className="mt-3 text-xs leading-relaxed text-foreground/90 font-mono border-l-2 border-primary/60 pl-3">
                {brief.verdictGuidance.actionNotice}
              </p>

              <div className="mt-5 space-y-4">
                <div className="space-y-1">
                  <p className="label-mono text-signal font-normal text-[10px] tracking-wider">Why Pursue</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.whyPursue.slice(0, 2).map((item: string, i: number) => (
                      <li key={i} className="text-[12px] leading-relaxed text-muted-foreground font-normal">
                        • {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1">
                  <p className="label-mono text-caution font-normal text-[10px] tracking-wider">Key Risk</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.watchFor.slice(0, 1).map((item: string, i: number) => (
                      <li key={i} className="text-[12px] leading-relaxed text-muted-foreground font-normal flex items-start gap-1">
                        <span className="text-caution/80 font-bold">•</span>
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
