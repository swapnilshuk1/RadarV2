import { useState } from "react";

interface StrategyWorkspaceProps {
  executionPkg: any;
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
    <div className={isMobile ? "memo-card p-3 space-y-4 bg-surface-raised border border-border/60" : "space-y-4"}>
      <div className={isMobile ? "grid grid-cols-2 gap-1.5 border-b border-border/40 pb-3" : "flex items-center justify-between border-b border-border pb-3"}>
        {!isMobile && <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Positioning Workspace</p>}
        <div className={isMobile ? "col-span-2 grid grid-cols-2 gap-1.5" : "flex gap-1.5"}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={isMobile 
                ? `py-2 px-1 text-center label-mono rounded-[3px] transition-colors border text-[9px] tracking-wider ${
                    activeTab === tab.id
                      ? "bg-foreground text-background border-foreground font-semibold"
                      : "bg-background text-muted-foreground border-border hover:text-foreground"
                  }`
                : `px-2.5 py-1 label-mono rounded transition-colors text-xs ${
                    activeTab === tab.id 
                      ? "bg-primary text-primary-foreground font-medium" 
                      : "text-muted-foreground hover:text-foreground"
                  }`
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "resume" && (
        <div className={isMobile ? "space-y-3 text-[11px] leading-relaxed" : "space-y-4"}>
          {executionPkg.resumeGaps.map((gap: any, i: number) => (
            <div key={i} className={`rounded border border-border bg-background p-3.5 text-xs space-y-2 ${isMobile ? "p-3" : "p-3.5"}`}>
              <p className="font-semibold text-primary">{gap.category}</p>
              <div className={isMobile ? "space-y-2" : "grid gap-2 sm:grid-cols-2"}>
                <div className={isMobile ? "space-y-0.5 border-b border-border/40 pb-1.5" : "space-y-1 border-r border-border pr-2"}>
                  <span className={`label-mono text-muted-foreground ${isMobile ? "text-[8px] tracking-wide" : ""}`}>Current Resume Narrative</span>
                  <p className="text-muted-foreground leading-relaxed">{gap.currentNarrative}</p>
                </div>
                <div className="space-y-1">
                  <span className={isMobile ? "label-mono text-signal text-[8px] tracking-wide" : "label-mono text-signal"}>Suggested Revision</span>
                  <p className={`text-foreground font-medium leading-relaxed ${isMobile ? "font-semibold" : ""}`}>{gap.suggestedRevision}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "linkedin" && (
        <div className={isMobile ? "space-y-2.5 text-[11px] leading-relaxed" : "space-y-3.5 text-xs"}>
          <div className={`rounded border border-border bg-background p-3.5 space-y-2 ${isMobile ? "p-3 space-y-1.5" : "p-3.5"}`}>
            <span className={isMobile ? "label-mono text-primary text-[8px]" : "label-mono text-primary"}>Recommended LinkedIn Headline</span>
            <p className={`text-foreground font-medium ${isMobile ? "font-semibold" : ""}`}>{executionPkg.linkedInStrategy.recommendedHeadline}</p>
          </div>
          <div className={`rounded border border-border bg-background p-3.5 space-y-2 ${isMobile ? "p-3 space-y-1.5" : "p-3.5"}`}>
            <span className={isMobile ? "label-mono text-primary text-[8px]" : "label-mono text-primary"}>Executive About Section Framing</span>
            <p className="text-muted-foreground leading-relaxed">{executionPkg.linkedInStrategy.executiveAboutFraming}</p>
          </div>
        </div>
      )}

      {activeTab === "screening" && (
        <div className={isMobile ? "space-y-2.5 text-[11px] leading-relaxed" : "space-y-3"}>
          {executionPkg.screeningQuestions.map((q: any, i: number) => (
            <div key={i} className={`rounded border border-border bg-background p-3 text-xs space-y-1 ${isMobile ? "p-3" : "p-3"}`}>
              <p className="font-semibold text-foreground">• {q.question}</p>
              <p className={isMobile ? "text-muted-foreground text-[10px] leading-relaxed" : "text-muted-foreground text-xs"}>
                <span className="text-primary font-semibold">Why {isMobile ? "" : "it matters"}:</span> {q.whyItMatters}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === "interview" && (
        <div className={isMobile ? "space-y-2.5 text-[11px] leading-relaxed" : "space-y-3.5 text-xs"}>
          <div className={`rounded border border-border bg-background p-3.5 space-y-1.5 ${isMobile ? "p-3 space-y-1" : "p-3.5"}`}>
            <span className={isMobile ? "label-mono text-primary text-[8px]" : "label-mono text-primary"}>60-Second Opening Hook</span>
            <p className="text-foreground italic">{executionPkg.interviewPrep.openingHook}</p>
          </div>
          <div className={`rounded border border-border bg-background p-3.5 space-y-1.5 ${isMobile ? "p-3 space-y-1" : "p-3.5"}`}>
            <span className={isMobile ? "label-mono text-primary text-[8px]" : "label-mono text-primary"}>Key Track Record Theme to Emphasize</span>
            <p className="text-muted-foreground">{executionPkg.interviewPrep.keyThemeToEmphasize}</p>
          </div>
          <div className={`rounded border border-border bg-background p-3.5 space-y-1.5 ${isMobile ? "p-3 space-y-1" : "p-3.5"}`}>
            <span className={isMobile ? "label-mono text-signal text-[8px]" : "label-mono text-signal"}>Strategic Question for the Panel</span>
            <p className={`text-foreground font-semibold ${isMobile ? "" : "font-medium"}`}>{executionPkg.interviewPrep.panelQuestion}</p>
          </div>
        </div>
      )}
    </div>
  );
}
