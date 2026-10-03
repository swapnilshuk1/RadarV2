import { CONTEXT_ACQUISITION_POLICY } from "./context-acquisition-policy";

/** Shared production capability boundary; probes vary only query/result budget. */
export function tavilySearchBody(
  query: string,
  maxResults = CONTEXT_ACQUISITION_POLICY.maxResults as number,
) {
  return {
    query,
    search_depth: CONTEXT_ACQUISITION_POLICY.searchDepth,
    max_results: maxResults,
    include_raw_content: "text",
    include_answer: false,
  };
}
export async function probeTavilyCapability(
  key: string | undefined,
  request: typeof fetch = fetch,
) {
  if (!key) throw new Error("TAVILY_HOST_KEY_UNCONFIGURED");
  const response = await request("https://api.tavily.com/search", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(tavilySearchBody("Oracle company official website", 1)),
  });
  if (!response.ok) throw new Error(`CONTEXT_SEARCH_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    results?: Array<{ url?: string; raw_content?: string }>;
  };
  if (
    !Array.isArray(payload.results) ||
    !payload.results.some((result) => {
      try {
        return (
          new URL(result.url ?? "").protocol === "https:" &&
          typeof result.raw_content === "string" &&
          result.raw_content.trim().length > 0
        );
      } catch {
        return false;
      }
    })
  )
    throw new Error("SEARCH_CAPABILITY_RESPONSE_INVALID");
}
