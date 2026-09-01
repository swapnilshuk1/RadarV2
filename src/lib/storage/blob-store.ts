/**
 * src/lib/storage/blob-store.ts
 *
 * RADAR v2 — Phase 4B: Durable Object / Blob Storage Abstraction.
 *
 * Invariant:
 * Enrichment and acquisition payloads are stored as content-addressed or
 * run-scoped blobs, decoupled from the local host filesystem.
 * Multi-instance workers lease jobs from Turso Cloud and fetch payloads
 * via BlobStore without needing shared disk access.
 */

import fs from "fs";
import path from "path";

export interface BlobMetadata {
  key: string;
  sizeBytes: number;
  contentType?: string;
  updatedAt: string;
}

export interface BlobStore {
  put(key: string, data: Buffer | Uint8Array | string, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; backend: string; error?: string }>;
}

/**
 * Local Filesystem Blob Store (used for local development / single-instance testing).
 */
export class LocalFsBlobStore implements BlobStore {
  constructor(private baseDir: string = path.resolve(process.cwd(), ".radar/artifacts/blobs")) {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    return path.join(this.baseDir, cleanKey);
  }

  async put(key: string, data: Buffer | Uint8Array | string, _contentType?: string): Promise<string> {
    const targetPath = this.resolvePath(key);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    fs.writeFileSync(targetPath, buf);
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const targetPath = this.resolvePath(key);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    return fs.readFileSync(targetPath);
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = this.resolvePath(key);
    return fs.existsSync(targetPath);
  }

  async delete(key: string): Promise<void> {
    const targetPath = this.resolvePath(key);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; backend: string; error?: string }> {
    try {
      const probeKey = "_health/probe.json";
      const payload = JSON.stringify({ ts: Date.now() });
      await this.put(probeKey, payload);
      const read = await this.get(probeKey);
      if (!read || read.toString("utf-8") !== payload) {
        throw new Error("Payload readback mismatch");
      }
      await this.delete(probeKey);
      return { ok: true, backend: "local_filesystem" };
    } catch (e: any) {
      return { ok: false, backend: "local_filesystem", error: e.message };
    }
  }
}

/**
 * In-Memory Blob Store (used for unit testing cross-instance isolation without touching disk).
 */
export class MemoryBlobStore implements BlobStore {
  private store = new Map<string, { buffer: Buffer; contentType?: string }>();

  async put(key: string, data: Buffer | Uint8Array | string, contentType?: string): Promise<string> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    this.store.set(key, { buffer: buf, contentType });
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const item = this.store.get(key);
    return item ? Buffer.from(item.buffer) : null;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async healthCheck(): Promise<{ ok: boolean; backend: string; error?: string }> {
    try {
      const probeKey = "_health/probe.json";
      const payload = JSON.stringify({ ts: Date.now() });
      await this.put(probeKey, payload);
      const read = await this.get(probeKey);
      if (!read || read.toString("utf-8") !== payload) {
        throw new Error("Payload readback mismatch");
      }
      await this.delete(probeKey);
      return { ok: true, backend: "in_memory" };
    } catch (e: any) {
      return { ok: false, backend: "in_memory", error: e.message };
    }
  }
}

/**
 * Lightweight S3 / R2 / MinIO compatible Blob Store using native fetch over standard REST API.
 */
export class S3CompatibleBlobStore implements BlobStore {
  private endpoint: string;
  private bucket: string;

  constructor(options?: { endpoint?: string; bucket?: string }) {
    this.endpoint = options?.endpoint || process.env.BLOB_STORAGE_ENDPOINT || "https://s3.amazonaws.com";
    this.bucket = options?.bucket || process.env.BLOB_STORAGE_BUCKET || "radar-snapshots";
  }

  private getUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    return `${this.endpoint.replace(/\/+$/, "")}/${this.bucket}/${cleanKey}`;
  }

  async put(key: string, data: Buffer | Uint8Array | string, contentType = "application/json"): Promise<string> {
    const url = this.getUrl(key);
    const body = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Failed to upload blob to ${url}: ${res.status} ${res.statusText}`);
    }
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const url = this.getUrl(key);
    const res = await fetch(url, { method: "GET" });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to retrieve blob from ${url}: ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async exists(key: string): Promise<boolean> {
    const url = this.getUrl(key);
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  }

  async delete(key: string): Promise<void> {
    const url = this.getUrl(key);
    await fetch(url, { method: "DELETE" });
  }

  async healthCheck(): Promise<{ ok: boolean; backend: string; error?: string }> {
    try {
      const probeKey = "_health/probe.json";
      const payload = JSON.stringify({ ts: Date.now() });
      await this.put(probeKey, payload);
      const read = await this.get(probeKey);
      if (!read || read.toString("utf-8") !== payload) {
        throw new Error("Payload readback mismatch");
      }
      await this.delete(probeKey);
      return { ok: true, backend: "s3_compatible" };
    } catch (e: any) {
      return { ok: false, backend: "s3_compatible", error: e.message };
    }
  }
}

export class BlobStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStoreConfigurationError";
  }
}

let _globalBlobStore: BlobStore | null = null;

export function getBlobStore(options?: { enforceDistributed?: boolean }): BlobStore {
  if (!_globalBlobStore) {
    if (process.env.BLOB_STORAGE_ENDPOINT && process.env.BLOB_STORAGE_BUCKET) {
      _globalBlobStore = new S3CompatibleBlobStore();
    } else if (options?.enforceDistributed || process.env.RADAR_DEPLOYMENT_MODE === "distributed") {
      throw new BlobStoreConfigurationError(
        "Distributed deployment mode requires remote object storage (BLOB_STORAGE_ENDPOINT and BLOB_STORAGE_BUCKET), but no remote storage is configured."
      );
    } else {
      _globalBlobStore = new LocalFsBlobStore();
    }
  }
  return _globalBlobStore;
}

export function setBlobStore(store: BlobStore | null): void {
  _globalBlobStore = store;
}

