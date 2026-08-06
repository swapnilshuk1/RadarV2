import * as React from "react";
import { cn } from "@/lib/utils";

const Eyebrow = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("font-mono text-[11px] uppercase tracking-wider text-ink-muted", className)}
      {...props}
    />
  )
);
Eyebrow.displayName = "Eyebrow";

const SectionTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal", className)}
      {...props}
    />
  )
);
SectionTitle.displayName = "SectionTitle";

const ExecutiveHeadline = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h1
      ref={ref}
      className={cn("font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-6xl text-foreground font-normal", className)}
      {...props}
    />
  )
);
ExecutiveHeadline.displayName = "ExecutiveHeadline";

const MetricLabel = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-[11px] font-mono uppercase tracking-[0.16em] text-ink-muted", className)}
      {...props}
    />
  )
);
MetricLabel.displayName = "MetricLabel";

const Caption = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-xs leading-relaxed text-muted-foreground font-normal", className)}
      {...props}
    />
  )
);
Caption.displayName = "Caption";

export { Eyebrow, SectionTitle, ExecutiveHeadline, MetricLabel, Caption };
