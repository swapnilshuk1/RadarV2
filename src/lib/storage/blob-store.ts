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

export interface ArtifactStoreLimits {
  maxBytes: number;
  maxFiles: number;
  retentionHours: number;
}

export interface ArtifactStoreStats {
  files: number;
  bytes: number;
  oldestUpdatedAt: string | null;
  retentionEligibleFiles: number;
  retentionEligibleBytes: number;
}

const DEFAULT_ARTIFACT_LIMITS: ArtifactStoreLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxFiles: 5_000,
  retentionHours: 7 * 24,
};

export class ArtifactStoreCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactStoreCapacityError";
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BlobStoreConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function resolveArtifactStoreLimits(env: NodeJS.ProcessEnv = process.env): ArtifactStoreLimits {
  return {
    maxBytes: positiveInteger(env.RADAR_ARTIFACT_MAX_BYTES, DEFAULT_ARTIFACT_LIMITS.maxBytes, "RADAR_ARTIFACT_MAX_BYTES"),
    maxFiles: positiveInteger(env.RADAR_ARTIFACT_MAX_FILES, DEFAULT_ARTIFACT_LIMITS.maxFiles, "RADAR_ARTIFACT_MAX_FILES"),
    retentionHours: positiveInteger(env.RADAR_ARTIFACT_RETENTION_HOURS, DEFAULT_ARTIFACT_LIMITS.retentionHours, "RADAR_ARTIFACT_RETENTION_HOURS"),
  };
}

/**
 * Local Filesystem Blob Store (used for local development / single-instance testing).
 */
export class LocalFsBlobStore implements BlobStore {
  private readonly resolvedBaseDir: string;

  constructor(
    private baseDir: string = path.resolve(process.cwd(), ".radar/artifacts/blobs"),
    private limits: ArtifactStoreLimits = resolveArtifactStoreLimits(),
  ) {
    this.resolvedBaseDir = path.resolve(this.baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    const targetPath = path.resolve(this.resolvedBaseDir, cleanKey);
    if (targetPath !== this.resolvedBaseDir && !targetPath.startsWith(`${this.resolvedBaseDir}${path.sep}`)) {
      throw new BlobStoreConfigurationError(`Artifact key escapes the configured store: ${key}`);
    }
    return targetPath;
  }

  public getStats(now = Date.now()): ArtifactStoreStats {
    const cutoff = now - this.limits.retentionHours * 60 * 60 * 1000;
    const stats: ArtifactStoreStats = { files: 0, bytes: 0, oldestUpdatedAt: null, retentionEligibleFiles: 0, retentionEligibleBytes: 0 };
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const itemPath = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(itemPath);
        else if (entry.isFile()) {
          const item = fs.statSync(itemPath);
          stats.files += 1;
          stats.bytes += item.size;
          if (!stats.oldestUpdatedAt || item.mtimeMs < Date.parse(stats.oldestUpdatedAt)) {
            stats.oldestUpdatedAt = item.mtime.toISOString();
          }
          if (item.mtimeMs < cutoff) {
            stats.retentionEligibleFiles += 1;
            stats.retentionEligibleBytes += item.size;
          }
        }
      }
    };
    if (fs.existsSync(this.resolvedBaseDir)) visit(this.resolvedBaseDir);
    return stats;
  }

  async put(key: string, data: Buffer | Uint8Array | string, _contentType?: string): Promise<string> {
    const targetPath = this.resolvePath(key);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
    const current = this.getStats();
    const existingBytes = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
    const projectedBytes = current.bytes - existingBytes + buf.byteLength;
    const projectedFiles = current.files + (existingBytes ? 0 : 1);
    if (projectedBytes > this.limits.maxBytes || projectedFiles > this.limits.maxFiles) {
      throw new ArtifactStoreCapacityError(
        `Artifact store capacity exceeded (projected ${projectedBytes}/${this.limits.maxBytes} bytes, ${projectedFiles}/${this.limits.maxFiles} files). Canonical Turso writes are unaffected.`
      );
    }
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

export type DeploymentMode = "single_host" | "distributed";

/**
 * Production topology is an explicit contract. Non-production callers retain
 * a single-host default so unit tests and local tools do not require a
 * deployment environment file.
 */
export function resolveDeploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const configured = env.RADAR_DEPLOYMENT_MODE;
  if (configured === "single_host" || configured === "distributed") {
    return configured;
  }
  if (configured) {
    throw new BlobStoreConfigurationError(
      `Unsupported RADAR_DEPLOYMENT_MODE '${configured}'. Expected 'single_host' or 'distributed'.`
    );
  }
  if (env.RADAR_ENV === "production" || env.NODE_ENV === "production") {
    throw new BlobStoreConfigurationError(
      "Production requires explicit RADAR_DEPLOYMENT_MODE ('single_host' or 'distributed')."
    );
  }
  return "single_host";
}

export function describeBlobStoreConfiguration(env: NodeJS.ProcessEnv = process.env): {
  mode: DeploymentMode;
  artifactBackend: "local_filesystem" | "s3_compatible";
  artifactLimits: ArtifactStoreLimits | null;
} {
  const mode = resolveDeploymentMode(env);
  const hasRemoteConfiguration = Boolean(env.BLOB_STORAGE_ENDPOINT && env.BLOB_STORAGE_BUCKET);
  if (mode === "distributed" && !hasRemoteConfiguration) {
    throw new BlobStoreConfigurationError(
      "Distributed deployment mode requires remote object storage (BLOB_STORAGE_ENDPOINT and BLOB_STORAGE_BUCKET)."
    );
  }
  return {
    mode,
    artifactBackend: hasRemoteConfiguration ? "s3_compatible" : "local_filesystem",
    artifactLimits: hasRemoteConfiguration ? null : resolveArtifactStoreLimits(env),
  };
}

let _globalBlobStore: BlobStore | null = null;

export function getBlobStore(options?: { enforceDistributed?: boolean }): BlobStore {
  if (!_globalBlobStore) {
    const config = describeBlobStoreConfiguration();
    if (options?.enforceDistributed && config.mode !== "distributed") {
      throw new BlobStoreConfigurationError("This caller requires distributed BlobStore mode, but RADAR_DEPLOYMENT_MODE is not 'distributed'.");
    }
    if (config.artifactBackend === "s3_compatible") {
      _globalBlobStore = new S3CompatibleBlobStore();
    } else {
      _globalBlobStore = new LocalFsBlobStore(undefined, config.artifactLimits || resolveArtifactStoreLimits());
    }
  }
  return _globalBlobStore;
}

export function setBlobStore(store: BlobStore | null): void {
  _globalBlobStore = store;
}
