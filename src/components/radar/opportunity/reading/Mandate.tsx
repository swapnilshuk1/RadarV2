interface MandateProps {
  brief: any;
}

export function Mandate({
  brief,
}: MandateProps) {
  const publishedOutcomes =
    Array.isArray(
      brief?.deliverablesWork,
    )
      ? brief.deliverablesWork
          .filter(
            (
              value: unknown,
            ): value is string =>
              typeof value === "string"
              && value.trim().length > 0,
          )
          .slice(0, 5)
      : [];

  const unknowns =
    Array.isArray(
      brief?.rankedUnknowns,
    )
      ? brief.rankedUnknowns
          .filter(
            (value: any) =>
              value
              && typeof value.question
                === "string"
              && value.question.trim(),
          )
          .slice(0, 3)
      : [];

  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-14 lg:self-start">
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">
          II
        </p>

        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
          What success requires
        </h2>
      </div>

      <div className="space-y-6">
        {brief?.structuredSections?.mandate?.thesis && (
          <p className="font-medium text-foreground text-sm leading-relaxed">
            {brief.structuredSections.mandate.thesis}
          </p>
        )}

        {publishedOutcomes.length > 0 && (
          <div>
            <p className="text-sm text-foreground font-normal mb-2.5">
              Published role outcomes:
            </p>

            <ul className="space-y-2 border-l-2 border-border pl-4">
              {publishedOutcomes.map(
                (
                  outcome: string,
                  index: number,
                ) => (
                  <li
                    key={index}
                    className="text-sm text-muted-foreground font-normal"
                  >
                    • {outcome}
                  </li>
                ),
              )}
            </ul>
          </div>
        )}

        {unknowns.length > 0 && (
          <div className="space-y-3 pt-2">
            <p className="text-sm font-medium text-foreground">
              Critical screening questions
            </p>

            <div className="space-y-3">
              {unknowns.map(
                (
                  unknown: any,
                  index: number,
                ) => (
                  <div
                    key={index}
                    className="space-y-0.5"
                  >
                    <p className="text-sm text-foreground font-normal">
                      {index + 1}. {unknown.question}
                    </p>

                    {(unknown.reason
                      || unknown.label) && (
                      <p className="text-xs text-muted-foreground leading-relaxed pl-4">
                        <span className="font-medium text-muted-foreground">
                          Context:
                        </span>{" "}
                        {unknown.reason
                          || unknown.label}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        {brief?.structuredSections?.mandate?.transition && (
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground italic font-serif">
              {brief.structuredSections.mandate.transition}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
