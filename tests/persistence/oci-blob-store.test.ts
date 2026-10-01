import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { OciObjectBlobStore, BlobIntegrityError, BlobStorageError } from "../../src/lib/storage/oci-blob-store";
import { describeBlobStoreConfiguration, getBlobStore, LocalFsBlobStore, setBlobStore, supportsCrossHostEnrichment } from "../../src/lib/storage/blob-store";

const options = { namespace: "test", bucket: "test", region: "ap-mumbai-1", maxAttempts: 1 };
const failure = (statusCode: number) => Object.assign(new Error("service error"), { statusCode });
function fixture() {
  const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();
  const client = {
    putObject: vi.fn(async (r: any) => {
      if (objects.has(r.objectName)) throw failure(412);
      objects.set(r.objectName, { bytes: Buffer.from(r.putObjectBody), metadata: r.opcMeta });
      return {};
    }),
    getObject: vi.fn(async (r: any) => {
      const object = objects.get(r.objectName);
      if (!object) throw failure(404);
      return { value: Readable.from([object.bytes]), contentLength: object.bytes.length, opcMeta: object.metadata };
    }),
    headObject: vi.fn(async (r: any) => { if (!objects.has(r.objectName)) throw failure(404); return {}; }),
    deleteObject: vi.fn(async (r: any) => { objects.delete(r.objectName); return {}; }),
  };
  const store = new OciObjectBlobStore(options, async () => client as any);
  return { objects, client, store };
}
afterEach(() => { vi.unstubAllEnvs(); setBlobStore(null); });

describe("native OCI BlobStore", () => {
  it("publishes create-only, verifies duplicate bytes, and rejects conflicting writers", async () => {
    const { store, client } = fixture();
    await Promise.all([store.put("payload.json", "same"), store.put("payload.json", "same")]);
    expect(client.putObject.mock.calls[0][0]).toMatchObject({ ifNoneMatch: "*", contentLength: 4,
      opcMeta: { sha256: createHash("sha256").update("same").digest("hex") } });
    await expect(store.put("payload.json", "different")).rejects.toBeInstanceOf(BlobIntegrityError);
    expect((await store.get("payload.json"))?.toString()).toBe("same");
  });
  it("distinguishes missing objects from authorization failures on reads and deletes", async () => {
    const { store, client } = fixture();
    expect(await store.get("missing")).toBeNull();
    expect(await store.exists("missing")).toBe(false);
    client.headObject.mockRejectedValueOnce(failure(403));
    await expect(store.exists("private")).rejects.toMatchObject({ status: 403, retryable: false });
    client.deleteObject.mockRejectedValueOnce(failure(403));
    await expect(store.delete("private")).rejects.toBeInstanceOf(BlobStorageError);
  });
  it("rejects corrupt object bytes before consumers receive them", async () => {
    const { store, objects } = fixture();
    await store.put("payload", "valid");
    objects.get("payload")!.bytes = Buffer.from("wrong");
    await expect(store.get("payload")).rejects.toBeInstanceOf(BlobIntegrityError);
  });
  it("retries transient failures with bounded attempts", async () => {
    const { client } = fixture();
    client.putObject.mockRejectedValueOnce(failure(503));
    const store = new OciObjectBlobStore({ ...options, maxAttempts: 2 }, async () => client as any);
    await store.put("retry", "bytes");
    expect(client.putObject).toHaveBeenCalledTimes(2);
  });
  it("recovers a lost upload acknowledgement without overwriting", async () => {
    const { client } = fixture();
    const original = client.putObject.getMockImplementation()!;
    client.putObject.mockImplementationOnce(async r => { await original(r); throw failure(503); });
    const store = new OciObjectBlobStore({ ...options, maxAttempts: 2 }, async () => client as any);
    await store.put("retry", "bytes");
    expect((await store.get("retry"))?.toString()).toBe("bytes");
  });
  it("rejects unsafe keys without touching the service", async () => {
    const { store, client } = fixture();
    for (const key of ["", "../a", "/a", "a\\b", "a//b"]) await expect(store.put(key, "x")).rejects.toBeInstanceOf(BlobIntegrityError);
    expect(client.putObject).not.toHaveBeenCalled();
  });
  it("uses independent health objects and retains processing payloads", async () => {
    const { store, client } = fixture();
    const checks = await Promise.all([store.healthCheck(), store.healthCheck()]);
    expect(checks.every(c => c.ok)).toBe(true);
    expect(new Set(client.putObject.mock.calls.map(c => c[0].objectName)).size).toBe(2);
    expect(store.retainProcessingPayloads).toBe(true);
  });
  it("validates OCI configuration without reading credentials", () => {
    const env = { RADAR_DEPLOYMENT_MODE: "distributed", BLOB_STORAGE_PROVIDER: "oci", OCI_NAMESPACE: "test", OCI_BUCKET: "test", OCI_REGION: "ap-mumbai-1" };
    expect(describeBlobStoreConfiguration(env)).toMatchObject({ artifactBackend: "oci_object_storage", artifactLimits: null });
    expect(supportsCrossHostEnrichment(env)).toBe(true);
    expect(() => describeBlobStoreConfiguration({ ...env, OCI_BUCKET: "" })).toThrow("OCI_BUCKET");
  });
  it("cannot bypass a distributed guard with a previously cached local store", () => {
    vi.stubEnv("RADAR_DEPLOYMENT_MODE", "distributed");
    vi.stubEnv("BLOB_STORAGE_PROVIDER", "oci");
    vi.stubEnv("OCI_NAMESPACE", "test"); vi.stubEnv("OCI_BUCKET", "test"); vi.stubEnv("OCI_REGION", "ap-mumbai-1");
    setBlobStore(new LocalFsBlobStore());
    expect(() => getBlobStore({ enforceDistributed: true })).toThrow("shared BlobStore");
  });
});
