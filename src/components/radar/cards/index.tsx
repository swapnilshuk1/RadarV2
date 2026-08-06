import * as React from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

const FeedCard = React.forwardRef<HTMLDivElement, DashboardCardProps>(
  ({ className, children, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn("bg-background border-hairline shadow-sm", className)}
      {...props}
    >
      {children}
    </Card>
  )
);
FeedCard.displayName = "FeedCard";

const WorkbenchCard = React.forwardRef<HTMLDivElement, DashboardCardProps>(
  ({ className, children, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn("bg-white border-sand-200 shadow-sm", className)}
      {...props}
    >
      {children}
    </Card>
  )
);
WorkbenchCard.displayName = "WorkbenchCard";

const EditorialPanel = React.forwardRef<HTMLDivElement, DashboardCardProps>(
  ({ className, children, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn("bg-surface-raised border-border shadow-sm", className)}
      {...props}
    >
      {children}
    </Card>
  )
);
EditorialPanel.displayName = "EditorialPanel";

export { FeedCard, WorkbenchCard, EditorialPanel };
