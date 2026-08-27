import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";
import { requireAuthUser } from "../auth/guard";

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((d?: { categoryId?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    return OpportunityService.listForUser(user.id, { categoryId: data?.categoryId });
  });

export const getShortlistMetricsFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    return OpportunityService.getMetricsForUser(user.id);
  });

export const getDecidedOpportunitiesFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    return OpportunityService.listDecidedForUser(user.id);
  });

export const getOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const user = await requireAuthUser();
    return OpportunityService.getForUser(user.id, jobHash);
  });

export const getQueueMetricsFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const user = await requireAuthUser();
    const adj = await OpportunityService.getAdjacentInfo(user.id, jobHash);
    return {
      currentIndex: adj.currentIndex,
      totalCount: adj.totalCount,
    };
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const user = await requireAuthUser();
    return OpportunityService.neighboursForUser(user.id, jobHash);
  });

export const getOpportunityDetailsFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const user = await requireAuthUser();
    return OpportunityService.getDetailsForUser(user.id, jobHash);
  });


