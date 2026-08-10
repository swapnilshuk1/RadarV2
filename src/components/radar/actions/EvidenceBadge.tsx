import * as React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface EvidenceBadgeProps extends Omit<BadgeProps, "variant"> {
  status: "matched" | "missing" | "adjacent" | "contradicted" | "neutral";
}

function EvidenceBadge({ className, status, ...props }: EvidenceBadgeProps) {
  let variantClasses = "";
  
  if (status === "matched") {
    variantClasses = "bg-evidence-matched/10 text-evidence-matched border-transparent";
  } else if (status === "missing") {
    variantClasses = "bg-evidence-missing/10 text-evidence-missing border-transparent";
  } else if (status === "adjacent") {
    variantClasses = "bg-evidence-adjacent/10 text-evidence-adjacent border-transparent";
  } else if (status === "contradicted") {
    variantClasses = "bg-evidence-contradicted/10 text-evidence-contradicted border-transparent";
  } else if (status === "neutral") {
    variantClasses = "border-hairline text-ink-muted bg-transparent";
  }

  return (
    <Badge
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium font-sans lowercase tracking-normal",
        variantClasses,
        className
      )}
      {...props}
    />
  );
}

export { EvidenceBadge };
