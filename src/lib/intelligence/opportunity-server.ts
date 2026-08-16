import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";
import { requireAuthUser } from "../auth/guard";

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    return OpportunityService.listForUser(user.id);
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
    const list = await OpportunityService.listForUser(user.id);
    const index = list.findIndex((o) => o.jobHash === jobHash);
    return {
      currentIndex: index >= 0 ? index + 1 : 1,
      totalCount: list.length || 1,
    };
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: jobHash }) => {
    const user = await requireAuthUser();
    return OpportunityService.neighboursForUser(user.id, jobHash);
  });

export const addExtraOpportunitiesFn = createServerFn({ method: "POST" })
  .handler(async () => {
    await requireAuthUser({ requireAdmin: true });
    OpportunityService.addExtra();
  });

export const injectFreshFn = createServerFn({ method: "POST" })
  .validator((d: any[]) => d)
  .handler(async ({ data: records }) => {
    await requireAuthUser({ requireAdmin: true });
    OpportunityService.injectFresh(records);
  });
