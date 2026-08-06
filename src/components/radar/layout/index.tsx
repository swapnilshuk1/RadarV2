import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow, SectionTitle, Caption } from "@/components/typography";

// --- Layout Spacing Primitives ---

const SectionSpacing = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mt-12 sm:mt-16", className)} {...props} />
  )
);
SectionSpacing.displayName = "SectionSpacing";

const ActionBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mt-8 flex flex-wrap items-center gap-3 sm:gap-4", className)} {...props} />
  )
);
ActionBar.displayName = "ActionBar";

const EditorialStack = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-6 sm:space-y-8", className)} {...props} />
  )
);
EditorialStack.displayName = "EditorialStack";

// --- Section Templates ---

export interface ExecutiveSectionProps extends React.HTMLAttributes<HTMLElement> {
  romanNumeral?: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

const ExecutiveSection = React.forwardRef<HTMLElement, ExecutiveSectionProps>(
  ({ className, romanNumeral, title, subtitle, badge, children, ...props }, ref) => (
    <section 
      ref={ref} 
      className={cn("grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start", className)} 
      {...props}
    >
      <div className="lg:sticky lg:top-24 lg:self-start">
        {romanNumeral && <p className="font-display text-2xl leading-none text-border-strong font-normal">{romanNumeral}</p>}
        <p className="label-mono mt-2 font-normal text-foreground">{title}</p>
        {subtitle && <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">{subtitle}</p>}
      </div>
      <div className="min-w-0">
        {children}
      </div>
    </section>
  )
);
ExecutiveSection.displayName = "ExecutiveSection";

export { SectionSpacing, ActionBar, EditorialStack, ExecutiveSection };
