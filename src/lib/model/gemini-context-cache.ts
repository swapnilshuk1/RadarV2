import { createHash } from "node:crypto";
import { ModelProviderUnavailableError, providerRetryAfterMs } from "./provider-unavailable";

type Entry = { name: string; expires: number } | null;
const pools = new WeakMap<typeof fetch, Map<string, Promise<Entry>>>();
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

/** Cache immutable shared evidence, never a verdict or a review response. Cloud
 * metadata allows worker restarts to reuse an unexpired content-addressed cache. */
export function geminiContextCacheRequest(request: typeof fetch): typeof fetch {
  let pool = pools.get(request);
  if (!pool) {
    pool = new Map();
    pools.set(request, pool);
  }
  const entries = pool;
  return async (url, options) => {
    if (
      typeof url !== "string" ||
      !url.endsWith(":generateContent") ||
      typeof options?.body !== "string"
    )
      return request(url, options);
    const body = JSON.parse(options.body);
    if (body.contents?.length !== 1 || body.contents[0].parts?.length !== 1)
      return request(url, options);
    const text = body.contents?.[0]?.parts?.[0]?.text;
    if (typeof text !== "string") return request(url, options);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      return request(url, options);
    }
    if (!input?.sharedContext || !body.systemInstruction) return request(url, options);
    const endpoint = new URL(url);
    const match = endpoint.pathname.match(
      /^\/v1\/(projects\/[^/]+\/locations\/[^/]+)\/publishers\/google\/models\/([^/:]+):generateContent$/,
    );
    if (!match) return request(url, options);
    if (match[2] !== "gemini-3.8-flash") return request(url, options);
    const parent = match[1],
      model = `${parent}/publishers/google/models/${match[2]}`;
    const common = {
      systemInstruction: body.systemInstruction,
      contents: [
        { role: "user", parts: [{ text: stable({ sharedContext: input.sharedContext }) }] },
      ],
    };
    const digest = createHash("sha256")
      .update(stable({ model, ...common }))
      .digest("hex");
    const key = `${endpoint.origin}/${parent}/${digest}`;
    const displayName = `radar-review-${digest}`;
    const base = `${endpoint.origin}/v1/${parent}/cachedContents`;
    const api = async (target: string, init: RequestInit = {}) => {
      const timeout = AbortSignal.timeout(30_000);
      const response = await request(target, {
        ...init,
        headers: options.headers,
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if (response.status === 429 || response.status >= 500)
        throw new ModelProviderUnavailableError(
          `Gemini context cache HTTP ${response.status}`,
          response.status,
          await providerRetryAfterMs(response),
        );
      return response;
    };
    const acquire = async (): Promise<Entry> => {
      // Listing returns cache metadata, not source contents. Never log its body.
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page++) {
        const list = await api(
          `${base}?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        );
        if (!list.ok) break; // Caching is optional; create may have different permissions.
        const payload = (await list.json()) as {
          cachedContents?: Array<{
            name: string;
            displayName: string;
            model: string;
            expireTime: string;
          }>;
          nextPageToken?: string;
        };
        const found = payload.cachedContents?.find(
          (c) =>
            c.displayName === displayName &&
            typeof c.name === "string" &&
            typeof c.model === "string" &&
            c.model.endsWith(`/models/${match[2]}`) &&
            Date.parse(c.expireTime) > Date.now() + 30_000,
        );
        if (found) return { name: found.name, expires: Date.parse(found.expireTime) };
        pageToken = payload.nextPageToken;
        if (!pageToken) break;
      }
      const counted = await api(url.replace(/:generateContent$/, ":countTokens"), {
        method: "POST",
        body: JSON.stringify(common),
      });
      if (!counted.ok) return null;
      const count = (await counted.json()) as { totalTokens?: number };
      // Gemini 3 Flash requires 4096 explicit-cache tokens. Never pad evidence.
      if (typeof count.totalTokens !== "number" || count.totalTokens < 4096) return null;
      const created = await api(base, {
        method: "POST",
        body: JSON.stringify({ model, displayName, ...common, ttl: "3600s" }),
      });
      if (!created.ok) return null; // Unsupported/unauthorized cache retains the full evidence request.
      const cache = (await created.json()) as { name?: string; expireTime?: string };
      if (!cache.name || !cache.expireTime || !Number.isFinite(Date.parse(cache.expireTime)))
        return null;
      return { name: cache.name, expires: Date.parse(cache.expireTime) };
    };
    let pending = entries.get(key);
    if (pending) {
      const entry = await pending;
      if (entry && entry.expires <= Date.now() + 30_000) {
        entries.delete(key);
        pending = undefined;
      }
    }
    if (!pending) {
      if (entries.size >= 32) entries.delete(entries.keys().next().value!);
      pending = acquire().catch((error) => {
        entries.delete(key);
        throw error;
      });
      entries.set(key, pending);
    }
    const cache = await pending;
    if (!cache) return request(url, options);
    const { sharedContext: _shared, ...specific } = input;
    const { systemInstruction: _instruction, ...cachedBody } = body;
    cachedBody.cachedContent = cache.name;
    cachedBody.contents = [{ role: "user", parts: [{ text: JSON.stringify(specific) }] }];
    const response = await request(url, { ...options, body: JSON.stringify(cachedBody) });
    if (response.status === 404) {
      entries.delete(key);
      throw new ModelProviderUnavailableError(
        "Gemini context cache expired; retry with refreshed evidence cache",
        503,
        30_000,
      );
    }
    return response;
  };
}
