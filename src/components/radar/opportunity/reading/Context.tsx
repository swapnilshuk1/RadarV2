import { AdvisoryConstitution } from "@/lib/intelligence/editorial/AdvisoryConstitution";
import { getFocusTopic } from "@/routes/opportunity.$jobHash";

interface ContextProps {
  o: any;
  brief: any;
  jobProj: any;
}

export function Context({ o, brief, jobProj }: ContextProps) {
  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Context</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
          Why is the company hiring for this role now?
        </h2>
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="font-medium text-lg text-primary font-display">Why this role exists</p>
          <p className="text-sm leading-relaxed text-foreground font-normal">
            {AdvisoryConstitution.getWhyThisRoleExistsParagraph(o, jobProj, getFocusTopic(o, jobProj))}
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <p className="font-medium text-lg text-primary font-display">What this means for your career</p>
          <ul className="space-y-2">
            {brief.strategicUpside.points.slice(0, 2).map((pt: string, idx: number) => (
              <li key={idx} className="text-sm text-muted-foreground leading-relaxed font-normal">• {pt}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
