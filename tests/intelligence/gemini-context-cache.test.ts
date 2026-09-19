import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiContextCacheRequest } from "../../src/lib/model/gemini-context-cache";

const url =
  "https://aiplatform.googleapis.com/v1/projects/test/locations/global/publishers/google/models/gemini-3.8-flash:generateContent";
const model = "projects/test/locations/global/publishers/google/models/gemini-3.8-flash";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const init = (job = "job-one", source = "immutable-profile-one", instruction = "Review facts") => ({
  method: "POST",
  headers: { Authorization: "Bearer test-only", "Content-Type": "application/json" },
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: instruction }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              sharedContext: { sourceFingerprint: source, candidateEvidence: ["candidate fact"] },
              job,
              passages: ["specific memo"],
            }),
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  }),
});

function server(tokens = 5000) {
  const stored: any[] = [],
    generated: any[] = [],
    created: any[] = [];
  const request = vi.fn(async (target: any, options?: RequestInit) => {
    if (String(target).includes("cachedContents?")) return json({ cachedContents: stored });
    if (String(target).endsWith(":countTokens")) return json({ totalTokens: tokens });
    if (String(target).endsWith("/cachedContents")) {
      const body = JSON.parse(options!.body as string);
      created.push(body);
      const entry = {
        ...body,
        name: `projects/test/locations/global/cachedContents/${created.length}`,
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      };
      stored.push(entry);
      return json(entry);
    }
    generated.push(JSON.parse(options!.body as string));
    return json({ usageMetadata: { cachedContentTokenCount: 5000 } });
  }) as unknown as typeof fetch;
  return { request, stored, generated, created };
}

afterEach(() => vi.useRealTimers());
describe("Gemini immutable candidate context cache", () => {
  it("shares candidate evidence across concurrent jobs without caching either job or dropping generation settings", async () => {
    const s = server(),
      request = geminiContextCacheRequest(s.request);
    await Promise.all([request(url, init()), request(url, init("job-two"))]);
    expect(s.created).toHaveLength(1);
    expect(JSON.stringify(s.created[0])).not.toContain("job-one");
    expect(s.created[0].ttl).toBe("3600s");
    expect(s.generated).toHaveLength(2);
    expect(s.generated[0].cachedContent).toBe(s.generated[1].cachedContent);
    expect(s.generated[0].systemInstruction).toBeUndefined();
    expect(JSON.stringify(s.generated[0])).not.toContain("candidate fact");
    expect(s.generated[0].generationConfig.responseMimeType).toBe("application/json");
    expect(JSON.parse(s.generated[1].contents[0].parts[0].text).job).toBe("job-two");
  });

  it("reuses cloud metadata after a process restart and invalidates changed source or review instruction", async () => {
    const s = server();
    await geminiContextCacheRequest(s.request)(url, init());
    const restarted: typeof fetch = (...args) => s.request(...args);
    await geminiContextCacheRequest(restarted)(url, init("job-two"));
    expect(s.created).toHaveLength(1);
    await geminiContextCacheRequest(restarted)(url, init("job-two", "profile-two"));
    await geminiContextCacheRequest(restarted)(
      url,
      init("job-two", "profile-two", "New review policy"),
    );
    expect(s.created).toHaveLength(3);
    expect(new Set(s.created.map((c) => c.displayName)).size).toBe(3);
    expect(s.created.every((c) => c.model === model)).toBe(true);
  });

  it("renews expired context before generation", async () => {
    vi.useFakeTimers();
    const s = server(),
      request = geminiContextCacheRequest(s.request);
    await request(url, init());
    vi.setSystemTime(Date.now() + 3_600_001);
    await request(url, init("job-two"));
    expect(s.created).toHaveLength(2);
    expect(s.generated[0].cachedContent).not.toBe(s.generated[1].cachedContent);
  });

  it("sends the complete original evidence below the minimum, without padding or creating a cache", async () => {
    const s = server(4095),
      original = init();
    await geminiContextCacheRequest(s.request)(url, original);
    expect(s.created).toHaveLength(0);
    expect(s.generated[0]).toEqual(JSON.parse(original.body));
  });

  it("retains complete evidence when cache creation is forbidden", async () => {
    const s = server();
    const request: typeof fetch = (target, options) =>
      String(target).endsWith("/cachedContents")
        ? Promise.resolve(json({}, 403))
        : s.request(target, options);
    const original = init();
    await geminiContextCacheRequest(request)(url, original);
    expect(s.generated[0]).toEqual(JSON.parse(original.body));
  });

  it("propagates cache rate limiting without issuing another inference request", async () => {
    const request = vi.fn(
      async () => new Response("{}", { status: 429, headers: { "retry-after": "42" } }),
    );
    await expect(
      geminiContextCacheRequest(request as typeof fetch)(url, init()),
    ).rejects.toMatchObject({ httpStatus: 429, retryAfterMs: 42000 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refreshes a missing cache on the next durable attempt, without an immediate duplicate generation", async () => {
    const s = server();
    let missing = true;
    const request: typeof fetch = (target, options) => {
      if (String(target).endsWith(":generateContent") && missing) {
        missing = false;
        s.stored.length = 0;
        return Promise.resolve(json({}, 404));
      }
      return s.request(target, options);
    };
    const cached = geminiContextCacheRequest(request);
    await expect(cached(url, init())).rejects.toMatchObject({ httpStatus: 503 });
    expect(s.generated).toHaveLength(0);
    await cached(url, init());
    expect(s.created).toHaveLength(2);
    expect(s.generated).toHaveLength(1);
  });
});
