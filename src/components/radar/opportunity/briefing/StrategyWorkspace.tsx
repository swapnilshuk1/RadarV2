import { useState } from "react";
import { ResumeSuggestion, ExecutionPackage } from "@/lib/intelligence/execution/types";

interface StrategyWorkspaceProps {
  executionPkg: ExecutionPackage;
  layout?: "desktop" | "mobile";
}

export function StrategyWorkspace({ executionPkg, layout = "desktop" }: StrategyWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"resume" | "linkedin" | "screening" | "interview">("resume");

  const isMobile = layout === "mobile";

  const tabs = [
    { id: "resume", label: isMobile ? "Resume" : "Resume Narrative" },
    { id: "linkedin", label: isMobile ? "LinkedIn" : "LinkedIn Strategy" },
    { id: "screening", label: isMobile ? "Screening Call" : "Screening Call" },
    { id: "interview", label: isMobile ? "Interview" : "Interview Strategy" },
  ] as const;

  return (
    <div className={isMobile ? "memo-card p-3 space-y-4 bg-surface-raised border border-border" : "space-y-4"}>
      <div className={isMobile ? "grid grid-cols-2 gap-2 border-b border-border pb-3" : "flex items-center justify-between border-b border-border pb-3"}>
        {!isMobile && <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Positioning Workspace</p>}
        <div className={isMobile ? "col-span-2 grid grid-cols-2 gap-2" : "flex gap-2"}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={isMobile 
                ? `py-2 px-1 text-center label-mono rounded transition-colors border tracking-wider ${
                    activeTab === tab.id
                      ? "bg-foreground text-background border-foreground font-semibold"
                      : "bg-background text-muted-foreground border-border hover:text-foreground"
                  }`
                : `px-3 py-1.5 label-mono transition-colors text-xs border-b-2 ${
                    activeTab === tab.id 
                      ? "border-foreground text-foreground font-medium" 
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "resume" && (
        <div className="space-y-4 text-xs leading-relaxed">
          {executionPkg.resumeGaps.map((gap: ResumeSuggestion, i: number) => {
            const isRewrite = gap.suggestionType === "TRUTH_PRESERVING_REWRITE";
            return (
              <div key={i} className="rounded border border-border bg-background p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-primary">{gap.category}</p>
                  <span className={`label-mono px-2 py-0.5 rounded text-xs ${isRewrite ? "bg-signal/10 text-signal border border-signal/30" : "bg-caution/10 text-caution border border-caution/30"}`}>
                    {isRewrite ? "Truth-Preserving Rewrite" : "Evidence Gap Advisory"}
                  </span>
                </div>

                <div className={isMobile ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
                  <div className={isMobile ? "space-y-1 border-b border-border pb-2" : "space-y-1 border-r border-border pr-3"}>
                    <span className="label-mono text-muted-foreground">Current Resume Narrative</span>
                    <p className="text-muted-foreground leading-relaxed">{gap.currentNarrative}</p>
                  </div>

                  <div className="space-y-1">
                    {isRewrite ? (
                      <>
                        <span className="label-mono text-signal">Grounded Suggested Revision</span>
                        <p className="text-foreground font-medium leading-relaxed">{gap.suggestedRevision}</p>
                        {gap.candidateEvidenceQuotes && gap.candidateEvidenceQuotes.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border">
                            <span className="label-mono text-muted-foreground block mb-0.5">Candidate Evidence Anchor:</span>
                            <p className="text-muted-foreground text-xs italic">"{gap.candidateEvidenceQuotes[0]}"</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="label-mono text-caution">Strategic Gap Coaching</span>
                        <p className="text-foreground leading-relaxed">{gap.coachingGuidance}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "linkedin" && (
        <div className="space-y-4 text-xs leading-relaxed">
          <div className="rounded border border-border bg-background p-4 space-y-2">
            <span className="label-mono text-primary">Recommended LinkedIn Headline</span>
            <p className="text-foreground font-medium">{executionPkg.linkedInStrategy.recommendedHeadline}</p>
          </div>
          <div className="rounded border border-border bg-background p-4 space-y-2">
            <span className="label-mono text-primary">Executive About Section Framing</span>
            <p className="text-muted-foreground leading-relaxed">{executionPkg.linkedInStrategy.executiveAboutFraming}</p>
          </div>
        </div>
      )}

      {activeTab === "screening" && (
        <div className="space-y-3 text-xs leading-relaxed">
          {executionPkg.screeningQuestions.map((q, i: number) => (
            <div key={i} className="rounded border border-border bg-background p-4 space-y-1.5">
              <p className="font-semibold text-foreground">• {q.question}</p>
              <p className="text-muted-foreground text-xs">
                <span className="text-primary font-semibold">Why it matters:</span> {q.whyItMatters}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === "interview" && (
        <div className="space-y-4 text-xs leading-relaxed">
          <div className="rounded border border-border bg-background p-4 space-y-1.5">
            <span className="label-mono text-primary">60-Second Opening Hook</span>
            <p className="text-foreground italic">{executionPkg.interviewPrep.openingHook}</p>
          </div>
          <div className="rounded border border-border bg-background p-4 space-y-1.5">
            <span className="label-mono text-primary">Key Track Record Theme to Emphasize</span>
            <p className="text-muted-foreground">{executionPkg.interviewPrep.keyThemeToEmphasize}</p>
          </div>
          <div className="rounded border border-border bg-background p-4 space-y-1.5">
            <span className="label-mono text-signal">Strategic Question for the Panel</span>
            <p className="text-foreground font-semibold">{executionPkg.interviewPrep.panelQuestion}</p>
          </div>
        </div>
      )}
    </div>
  );
}
