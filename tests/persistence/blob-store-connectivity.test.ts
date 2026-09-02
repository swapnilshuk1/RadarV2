import { describe, expect, it, vi } from "vitest";
import {
  LocalFsBlobStore,
  MemoryBlobStore,
  S3CompatibleBlobStore,
  ArtifactStoreCapacityError,
  BlobStoreConfigurationError,
  describeBlobStoreConfiguration,
  getBlobStore,
  resolveDeploymentMode,
  setBlobStore,
} from "../../src/lib/storage/blob-store";
import fs from "fs";
import path from "path";

describe("Phase 4C: BlobStore Connectivity & Backend Protocol Verification", () => {
  it("0. requires an explicit production mode and rejects ambiguous values", () => {
    expect(() => resolveDeploymentMode({ RADAR_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(BlobStoreConfigurationError);
    expect(() => resolveDeploymentMode({ RADAR_DEPLOYMENT_MODE: "multi_host" } as NodeJS.ProcessEnv)).toThrow(BlobStoreConfigurationError);
    expect(describeBlobStoreConfiguration({ RADAR_DEPLOYMENT_MODE: "single_host" } as NodeJS.ProcessEnv)).toEqual({
      mode: "single_host",
      artifactBackend: "local_filesystem",
      artifactLimits: { maxBytes: 512 * 1024 * 1024, maxFiles: 5_000, retentionHours: 7 * 24 },
    });
  });

  it("1. MemoryBlobStore roundtrip & health check", async () => {
    const memStore = new MemoryBlobStore();
    const check = await memStore.healthCheck();
    expect(check.ok).toBe(true);
    expect(check.backend).toBe("in_memory");

    await memStore.put("test/key.json", JSON.stringify({ hello: "world" }), "application/json");
    expect(await memStore.exists("test/key.json")).toBe(true);

    const data = await memStore.get("test/key.json");
    expect(data).not.toBeNull();
    expect(JSON.parse(data!.toString("utf-8"))).toEqual({ hello: "world" });

    await memStore.delete("test/key.json");
    expect(await memStore.exists("test/key.json")).toBe(false);
    expect(await memStore.get("test/key.json")).toBeNull();
  });

  it("2. LocalFsBlobStore roundtrip & health check", async () => {
    const testDir = path.resolve(process.cwd(), ".radar/test_blobs_" + Date.now());
    const fsStore = new LocalFsBlobStore(testDir);

    const check = await fsStore.healthCheck();
    expect(check.ok).toBe(true);
    expect(check.backend).toBe("local_filesystem");

    await fsStore.put("sub/path/item.json", "content-123");
    expect(await fsStore.exists("sub/path/item.json")).toBe(true);

    const retrieved = await fsStore.get("sub/path/item.json");
    expect(retrieved!.toString("utf-8")).toBe("content-123");

    await fsStore.delete("sub/path/item.json");
    expect(await fsStore.exists("sub/path/item.json")).toBe(false);

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("2b. LocalFsBlobStore rejects quota exhaustion and path escapes before persistence", async () => {
    const testDir = path.resolve(process.cwd(), ".radar/test_blob_capacity_" + Date.now());
    const fsStore = new LocalFsBlobStore(testDir, { maxBytes: 8, maxFiles: 1, retentionHours: 1 });
    try {
      await fsStore.put("snapshots/one.json", "12345678");
      await expect(fsStore.put("snapshots/two.json", "x")).rejects.toThrow(ArtifactStoreCapacityError);
      await expect(fsStore.put("../outside.json", "x")).rejects.toThrow(BlobStoreConfigurationError);
      expect(fsStore.getStats().files).toBe(1);
      expect(fsStore.getStats().bytes).toBe(8);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("3. S3CompatibleBlobStore REST protocol & endpoint routing", async () => {
    const originalFetch = globalThis.fetch;
    const mockStorage = new Map<string, { body: string; headers: Record<string, string> }>();

    // Mock native fetch for S3 REST endpoint verification
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const urlStr = url.toString();
      const method = init?.method || "GET";

      if (method === "PUT") {
        mockStorage.set(urlStr, { body: init.body.toString("utf-8"), headers: init.headers });
        return new Response(null, { status: 200, statusText: "OK" });
      }

      if (method === "GET") {
        const item = mockStorage.get(urlStr);
        if (!item) {
          return new Response("Not Found", { status: 404, statusText: "Not Found" });
        }
        return new Response(item.body, { status: 200, statusText: "OK" });
      }

      if (method === "HEAD") {
        const exists = mockStorage.has(urlStr);
        return new Response(null, { status: exists ? 200 : 404 });
      }

      if (method === "DELETE") {
        mockStorage.delete(urlStr);
        return new Response(null, { status: 204 });
      }

      return new Response("Unsupported", { status: 400 });
    }) as any;

    try {
      const s3Store = new S3CompatibleBlobStore({
        endpoint: "https://r2.cloudflarestorage.com",
        bucket: "radar-production-blobs",
      });

      const check = await s3Store.healthCheck();
      expect(check.ok).toBe(true);
      expect(check.backend).toBe("s3_compatible");

      // Verify URL formatting
      await s3Store.put("snapshots/job-123.json", JSON.stringify({ payload: "verified" }));
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://r2.cloudflarestorage.com/radar-production-blobs/snapshots/job-123.json",
        expect.objectContaining({ method: "PUT" })
      );

      const exists = await s3Store.exists("snapshots/job-123.json");
      expect(exists).toBe(true);

      const retrieved = await s3Store.get("snapshots/job-123.json");
      expect(JSON.parse(retrieved!.toString("utf-8"))).toEqual({ payload: "verified" });

      const missing = await s3Store.get("snapshots/nonexistent.json");
      expect(missing).toBeNull();

      await s3Store.delete("snapshots/job-123.json");
      expect(await s3Store.exists("snapshots/job-123.json")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("4. S3CompatibleBlobStore handles server error responses safely", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
    }) as any;

    try {
      const s3Store = new S3CompatibleBlobStore({
        endpoint: "https://s3.us-east-1.amazonaws.com",
        bucket: "faulty-bucket",
      });

      await expect(s3Store.put("error.json", "data")).rejects.toThrow("Failed to upload blob");
      await expect(s3Store.get("error.json")).rejects.toThrow("Failed to retrieve blob");

      const check = await s3Store.healthCheck();
      expect(check.ok).toBe(false);
      expect(check.error).toContain("Failed to upload blob");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
