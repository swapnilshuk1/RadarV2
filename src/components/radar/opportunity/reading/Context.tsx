import { AdvisoryConstitution } from "@/lib/intelligence/editorial/AdvisoryConstitution";
import { getFocusTopic } from "@/routes/opportunity.$jobHash";

interface ContextProps {
  o: any;
  brief: any;
  jobProj: any;
}

export function Context({ o, brief, jobProj }: ContextProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-14 lg:self-start">
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">I</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
          Why this deserves your attention
        </h2>
      </div>
      <div className="space-y-5">
        {brief.structuredSections?.context?.thesis && (
          <p className="font-medium text-foreground text-sm leading-relaxed">
            {brief.structuredSections.context.thesis}
          </p>
        )}
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-muted-foreground font-normal">
            {AdvisoryConstitution.getWhyThisRoleExistsParagraph(o, jobProj, getFocusTopic(o, jobProj))}
          </p>
        </div>

        <div className="pt-2">
          <ul className="space-y-2">
            {brief.strategicUpside.points.slice(0, 2).map((pt: string, idx: number) => (
              <li key={idx} className="text-sm text-muted-foreground leading-relaxed font-normal">• {pt}</li>
            ))}
          </ul>
        </div>
        
        {brief.structuredSections?.context?.transition && (
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground italic font-serif">
              {brief.structuredSections.context.transition}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
