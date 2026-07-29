import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .handler(async () => {
    // Hardcoded dev user for now; in the future this would come from ctx.session.userId
    const userId = "swapnil-shukla-dev";
    return OpportunityService.listForUser(userId);
  });

export const getOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const userId = "swapnil-shukla-dev";
    return OpportunityService.getForUser(userId, jobHash);
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const userId = "swapnil-shukla-dev";
    return OpportunityService.neighboursForUser(userId, jobHash);
  });

export const addExtraOpportunitiesFn = createServerFn({ method: "POST" })
  .handler(async () => {
    OpportunityService.addExtra();
  });

export const injectFreshFn = createServerFn({ method: "POST" })
  .validator((d: any[]) => d)
  .handler(async ({ data: records }) => {
    OpportunityService.injectFresh(records);
  });
