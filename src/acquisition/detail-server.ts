import { createServerFn } from '@tanstack/react-start';
import { requireAuthUser } from '@/lib/auth/guard';
import { resolveServingScope } from '@/lib/security/scope-resolver';
import { getDatabaseAdapter } from '@/data/database';
import type { ScrapedJobDetail } from './contracts';

export const getScrapedJobDetailFn = createServerFn({ method: 'GET' })
  .validator((input: { jobHash: string; tenantId?: string; personId?: string }) => {
    if (!input?.jobHash) throw new Error('JOB_HASH_REQUIRED');
    if (Boolean(input?.tenantId) !== Boolean(input?.personId)) throw new Error('CANDIDATE_SCOPE_INCOMPLETE');
    return {
      jobHash: String(input.jobHash),
      tenantId: input.tenantId ? String(input.tenantId) : undefined,
      personId: input.personId ? String(input.personId) : undefined,
    };
  })
  .handler(async ({ data }): Promise<ScrapedJobDetail | null> => {
    const user = await requireAuthUser();
    const { scope, activeContext } = await resolveServingScope(
      user.id,
      data.tenantId,
      getDatabaseAdapter(),
      data.personId
    );
    if (!activeContext) return null;
    const { readScrapedJobDetail } = await import('./detail-read-model');
    return readScrapedJobDetail(getDatabaseAdapter(), scope, activeContext, data.jobHash);
  });
