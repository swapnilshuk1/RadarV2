import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DecisionVerb } from "@/data/opportunity-fixtures";

export interface ExecutiveActionButtonProps extends Omit<ButtonProps, "variant"> {
  verdict: DecisionVerb;
  isActive?: boolean;
}

const ExecutiveActionButton = React.forwardRef<HTMLButtonElement, ExecutiveActionButtonProps>(
  ({ className, verdict, isActive, ...props }, ref) => {
    let variantClasses = "";
    
    if (isActive) {
      if (verdict === "PURSUE") {
        variantClasses = "bg-signal text-white font-medium shadow-xs hover:opacity-90";
      } else if (verdict === "CONSIDER") {
        variantClasses = "bg-caution text-white font-medium shadow-xs hover:opacity-90";
      } else if (verdict === "PASS") {
        variantClasses = "bg-foreground text-background font-medium shadow-xs hover:opacity-90";
      }
    } else {
      if (verdict === "PURSUE") {
        variantClasses = "bg-surface-raised text-foreground border border-border hover:border-signal hover:bg-signal/5";
      } else if (verdict === "CONSIDER") {
        variantClasses = "bg-surface-raised text-foreground border border-border hover:border-caution hover:bg-caution/5";
      } else if (verdict === "PASS") {
        variantClasses = "bg-surface-raised text-foreground border border-border hover:border-foreground hover:bg-foreground/5";
      }
    }

    return (
      <Button
        ref={ref}
        className={cn(
          "py-2.5 text-xs font-mono uppercase tracking-[0.14em] transition-all cursor-pointer rounded h-auto",
          variantClasses,
          className
        )}
        {...props}
      />
    );
  }
);
ExecutiveActionButton.displayName = "ExecutiveActionButton";

export { ExecutiveActionButton };
