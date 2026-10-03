import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { DatabaseAdapter } from "@/data/database";
import type {
  AcquisitionAttempt,
  ContextProvider,
  EvidenceSource,
  SliceInput,
} from "@/dossier/contracts";
import { ModelProviderUnavailableError } from "@/lib/model/provider-unavailable";
import { CONTEXT_ACQUISITION_POLICY as policy } from "@/evaluation/context-acquisition-policy";
import { CompanyWebsiteProvider } from "@/dossier/context";
import { resolveSearchCredential, TAVILY_CONNECTION } from "../admin/search-connections";
import {
  assertProviderDispatch,
  acquireProviderCapacity,
  releaseProviderCapacity,
  observeProviderFailure,
  operationalSettings,
  providerSucceeded,
} from "../admin/operations-runtime";
import { classifySearchFailure, type WorkIdentity } from "../admin/operations-contracts";
import { getDatabaseTargetIdentity } from "../data/database";

function publicHttps(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local")
  )
    throw new Error("CONTEXT_PUBLIC_HTTPS_REQUIRED");
  return url;
}

const BUSINESS_TYPE_NOUNS = new Set([
  "agency",
  "marketplace",
  "platform",
  "software",
  "saas",
  "beverage",
  "fintech",
  "ecommerce",
]);

function compactIdentityHint(terms: readonly string[]): string | undefined {
  for (const term of terms) {
    const words = term
      .replace(/[’']/g, "")
      .replace(/[^A-Za-z0-9-]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (let index = 0; index < words.length; index++) {
      const noun = words[index]!.toLocaleLowerCase();
      if (!BUSINESS_TYPE_NOUNS.has(noun)) continue;
      const preceding = words
        .slice(Math.max(0, index - 2), index)
        .map((word) => word.toLocaleLowerCase())
        .filter((word) => !["a", "an", "the", "is", "and", "of", "for"].includes(word));
      if (preceding.length) return preceding.join(" ");
    }
  }
  return undefined;
}

function attemptRows(
  fields: readonly string[],
  provider: string,
  operation: "retrieve" | "search",
  ids: string[],
  detail: string,
): AcquisitionAttempt[] {
  return fields.map((field) => ({
    provider,
    field,
    operation,
    status: ids.length
      ? ("RETRIEVED" as const)
      : provider === "context-web-search"
        ? ("NO_RESULTS" as const)
        : ("UNAVAILABLE" as const),
    sourceIds: ids,
    detail,
  }));
}

import { loadUnifiedEnvironment } from "@/lib/env";

function resolveTavilyApiKey(key?: string): string | undefined {
  if (key !== undefined) return key.trim() || undefined;
  if (process.env.TAVILY_API_KEY?.trim()) return process.env.TAVILY_API_KEY.trim();
  try {
    loadUnifiedEnvironment();
  } catch {}
  return process.env.TAVILY_API_KEY?.trim() || undefined;
}

/** Uses verified company identity plus bounded web search; never sends candidate sources. */
export class ProductionContextProvider implements ContextProvider {
  readonly id = policy.version;
  private readonly searchKey?: string;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly tenantId: string,
    private readonly request: typeof fetch = fetch,
    searchKey?: string,
    private readonly work?: WorkIdentity,
  ) {
    this.searchKey = searchKey === undefined ? undefined : resolveTavilyApiKey(searchKey);
  }

  async acquire(opportunity: SliceInput["opportunity"], fields: readonly string[]) {
    const credential =
      this.searchKey !== undefined
        ? { key: this.searchKey, generation: 0, credentialId: null }
        : await resolveSearchCredential(this.db).catch(async () => {
            const active = await this.db.one<{ generation: number }>(
              "SELECT generation FROM admin_search_connection WHERE id=1",
            );
            await observeProviderFailure(this.db, {
              connectionId: TAVILY_CONNECTION,
              provider: "tavily",
              generation: active?.generation ?? 0,
              failure: "vault",
              deployment: getDatabaseTargetIdentity().fingerprint,
              work: this.work,
            });
            throw new ModelProviderUnavailableError("CONTEXT_SEARCH_VAULT_UNREADABLE");
          });
    if (!credential.key?.trim())
      throw new ModelProviderUnavailableError("CONTEXT_SEARCH_CONFIGURATION_REQUIRED");
    await assertProviderDispatch(this.db, TAVILY_CONNECTION, this.work);
    const name = opportunity.company.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    const researchMeta = opportunity as SliceInput["opportunity"] & {
      researchAliases?: string[];
      researchIdentityTerms?: string[];
    };
    const researchAliases = (researchMeta.researchAliases ?? [])
      .map((alias) => alias.trim())
      .filter(Boolean)
      .slice(0, 3);
    const researchIdentityTerms = (researchMeta.researchIdentityTerms ?? [])
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 3);
    const identityHint = compactIdentityHint(researchIdentityTerms);
    const entity = await this.db.one<{ official_domain: string | null }>(
      `SELECT official_domain FROM intelligence_company_entities WHERE tenant_id=? AND normalized_name=?`,
      [this.tenantId, name],
    );

    const websitePromise = (async () => {
      if (!entity?.official_domain) {
        return {
          sources: [] as EvidenceSource[],
          attempts: attemptRows(
            fields,
            "company-website",
            "retrieve",
            [],
            "No verified official domain is bound to this company identity.",
          ),
        };
      }
      try {
        const url = publicHttps(
          entity.official_domain.includes("://")
            ? entity.official_domain
            : `https://${entity.official_domain}`,
        ).origin;
        return await new CompanyWebsiteProvider(
          [{ url, title: `${opportunity.company} — official website` }],
          this.request,
        ).acquire(opportunity, fields);
      } catch {
        return {
          sources: [] as EvidenceSource[],
          attempts: attemptRows(
            fields,
            "company-website",
            "retrieve",
            [],
            "Verified company website could not be retrieved.",
          ),
        };
      }
    })();

    const searchPromise = (async () => {
      const owner = `context:${process.pid}:${this.work?.jobId ?? this.tenantId}`;
      const settings = await operationalSettings(this.db);
      const capacity = await acquireProviderCapacity(
        this.db,
        TAVILY_CONNECTION,
        owner,
        settings.settings.profile === "Recovery" ? 1 : settings.settings.providerConcurrency,
        Date.now(),
        60_000,
      );
      try {
        const response = await this.request("https://api.tavily.com/search", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(25_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credential.key}`,
          },
          body: JSON.stringify({
            query: [
              [opportunity.company, ...researchAliases].map((value) => `"${value}"`).join(" OR "),
              identityHint ? `"${identityHint}"` : "",
              identityHint ? "company team" : policy.querySuffix,
            ]
              .filter(Boolean)
              .join(" "),
            search_depth: policy.searchDepth,
            max_results: policy.maxResults,
            include_raw_content: "text",
            include_answer: false,
          }),
        });
        if (!response.ok) {
          const retryHeader = response.headers.get("retry-after");
          const retryAfterMs = retryHeader
            ? Math.min(
                15 * 60_000,
                Math.max(
                  0,
                  Number.isFinite(Number(retryHeader))
                    ? Number(retryHeader) * 1000
                    : Date.parse(retryHeader) - Date.now(),
                ),
              )
            : undefined;
          await observeProviderFailure(this.db, {
            connectionId: TAVILY_CONNECTION,
            provider: "tavily",
            generation: credential.generation,
            failure: classifySearchFailure(response.status),
            deployment: getDatabaseTargetIdentity().fingerprint,
            status: response.status,
            retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
            work: this.work,
          });
          throw new ModelProviderUnavailableError(
            `CONTEXT_SEARCH_HTTP_${response.status}`,
            response.status,
            Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
          );
        }
        const payload = (await response.json()) as {
          results?: Array<{
            url?: string;
            title?: string;
            raw_content?: string | null;
            content?: string;
          }>;
        };
        if (!Array.isArray(payload.results)) throw new Error("CONTEXT_SEARCH_RESPONSE_INVALID");
        await providerSucceeded(this.db, TAVILY_CONNECTION, credential.generation);
        const found: EvidenceSource[] = [];
        for (const result of payload.results) {
          if (typeof result.url !== "string") continue;
          let url: URL;
          try {
            url = publicHttps(result.url);
          } catch {
            continue;
          }
          const content =
            typeof result.raw_content === "string" ? result.raw_content : result.content;
          if (typeof content !== "string" || !content.trim()) continue;
          const text = content.trim().slice(0, policy.maxSourceCharacters);
          found.push({
            id: `context-${createHash("sha256")
              .update(url.href + text)
              .digest("hex")
              .slice(0, 16)}`,
            plane: "CONTEXT",
            title: result.title || url.hostname,
            locator: url.href,
            text,
            capturedAt: new Date().toISOString(),
            attribution: "INDEPENDENT",
          });
        }
        return {
          sources: found,
          attempts: attemptRows(
            fields,
            "context-web-search",
            "search",
            found.map((source) => source.id),
            "Retrieved web evidence; company identity and relevance must be checked before using its claims. Retrieval does not establish that any requested field is answered.",
          ),
        };
      } catch (error) {
        if (error instanceof ModelProviderUnavailableError) throw error;
        await observeProviderFailure(this.db, {
          connectionId: TAVILY_CONNECTION,
          provider: "tavily",
          generation: credential.generation,
          failure: classifySearchFailure(
            undefined,
            error instanceof Error && /timeout|abort/i.test(error.name)
              ? "TIMEOUT"
              : error instanceof Error && error.message === "CONTEXT_SEARCH_RESPONSE_INVALID"
                ? "INVALID_RESPONSE"
                : undefined,
          ),
          deployment: getDatabaseTargetIdentity().fingerprint,
          work: this.work,
        });
        throw new ModelProviderUnavailableError(
          error instanceof Error && /^CONTEXT_SEARCH_HTTP_\d+$/.test(error.message)
            ? error.message
            : "CONTEXT_SEARCH_UNAVAILABLE",
        );
      } finally {
        await releaseProviderCapacity(this.db, capacity, owner);
      }
    })();

    const [website, search] = await Promise.all([websitePromise, searchPromise]);
    return {
      sources: [
        ...new Map(
          [...website.sources, ...search.sources].map((source) => [source.id, source]),
        ).values(),
      ],
      attempts: [...website.attempts, ...search.attempts],
    };
  }
}
