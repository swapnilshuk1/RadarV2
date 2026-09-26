import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";
import { requireAuthUser } from "../auth/guard";

type CandidateScopeRequest = { tenantId?: string; personId?: string };
function candidateScope(data?: CandidateScopeRequest) {
  if (Boolean(data?.tenantId) !== Boolean(data?.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
  return data;
}

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((d?: { categoryId?: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.listForUser(user.id, { categoryId: data?.categoryId }, scope?.tenantId, scope?.personId);
  });

export const getFeedFn = createServerFn({ method: "GET" })
  .validator(
    (d?: {
      cursor?: string;
      categoryId?: string;
      decisionFilter?: "all" | "unreviewed" | "decided";
      pageSize?: number;
    } & CandidateScopeRequest) => d
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    return OpportunityService.getFeedForUser(
      user.id,
      data?.cursor as any,
      {
        categoryId: data?.categoryId as any,
        decisionFilter: data?.decisionFilter,
      },
      data?.pageSize,
      candidateScope(data)?.tenantId,
      candidateScope(data)?.personId,
    );
  });

export const getShortlistMetricsFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getMetricsForUser(user.id, scope?.tenantId, scope?.personId);
  });

export const getDecidedOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.listDecidedForUser(user.id, scope?.tenantId, scope?.personId);
  });

export const getOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });

export const getQueueMetricsFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    const adj = await OpportunityService.getAdjacentInfo(user.id, data.jobHash, scope?.tenantId, scope?.personId);
    return {
      currentIndex: adj.currentIndex,
      totalCount: adj.totalCount,
    };
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.neighboursForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });

export const getOpportunityDetailsFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getDetailsForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });


