import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .handler(async () => {
    // Dev user matching decisions-server and document-server
    const userId = "swapnil-shukla";
    return OpportunityService.listForUser(userId);
  });

export const getOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const userId = "swapnil-shukla";
    return OpportunityService.getForUser(userId, jobHash);
  });

export const getQueueMetricsFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const userId = "swapnil-shukla";
    const list = await OpportunityService.listForUser(userId);
    const index = list.findIndex((o) => o.jobHash === jobHash);
    return {
      currentIndex: index >= 0 ? index + 1 : 1,
      totalCount: list.length || 1,
    };
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const userId = "swapnil-shukla";
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
