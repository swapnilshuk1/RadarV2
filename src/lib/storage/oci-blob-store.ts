import { createHash, randomUUID } from "node:crypto";
import type { BlobStore } from "./blob-store";
import type { ObjectStorageClient } from "oci-objectstorage";

export class BlobIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "BlobIntegrityError"; }
}

export class BlobStorageError extends Error {
  constructor(public readonly status: number | undefined, public readonly retryable: boolean) {
    super(`OCI_BLOB_${retryable ? "NETWORK" : "ERROR"}: status=${status ?? "transport"}`);
    this.name = "BlobStorageError";
  }
}

export interface OciBlobOptions {
  namespace: string;
  bucket: string;
  region: string;
  configFile?: string;
  profile?: string;
  auth?: "config_file" | "instance_principal";
  timeoutMs?: number;
  maxAttempts?: number;
}

type Client = Pick<ObjectStorageClient, "putObject" | "getObject" | "headObject" | "deleteObject">;
type ClientFactory = (signal: AbortSignal) => Promise<Client>;

export function ociOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): OciBlobOptions {
  for (const name of ["OCI_NAMESPACE", "OCI_BUCKET", "OCI_REGION"]) {
    if (!env[name]?.trim()) throw new Error(`OCI BlobStore requires ${name}`);
  }
  const auth = env.OCI_AUTH_METHOD || "config_file";
  if (auth !== "config_file" && auth !== "instance_principal") throw new Error("Unsupported OCI_AUTH_METHOD");
  return { namespace: env.OCI_NAMESPACE!, bucket: env.OCI_BUCKET!, region: env.OCI_REGION!,
    configFile: env.OCI_CONFIG_FILE, profile: env.OCI_CONFIG_PROFILE || "DEFAULT", auth };
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function statusOf(error: unknown): number | undefined { return (error as { statusCode?: number })?.statusCode; }

/** Native signed OCI access. Every put is create-only, including retry after a lost acknowledgement. */
export class OciObjectBlobStore implements BlobStore {
  readonly shared = true;
  readonly retainProcessingPayloads = true;
  private readonly factory: ClientFactory;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: OciBlobOptions, factory?: ClientFactory) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 ||
        !Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 5) {
      throw new Error("Invalid OCI timeout/attempt limits");
    }
    let provider: Promise<import("oci-common").AuthenticationDetailsProvider> | undefined;
    this.factory = factory || (async signal => {
      const common = await import("oci-common");
      const { ObjectStorageClient } = await import("oci-objectstorage");
      provider ??= options.auth === "instance_principal"
        ? new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build()
        : Promise.resolve(new common.ConfigFileAuthenticationDetailsProvider(options.configFile, options.profile || "DEFAULT"));
      const client = new ObjectStorageClient({ authenticationDetailsProvider: await provider }, {
        retryConfiguration: common.NoRetryConfigurationDetails,
        httpOptions: { signal },
      });
      client.regionId = options.region;
      return client;
    });
  }

  private reference(key: string) {
    if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some(p => !p || p === "." || p === "..")) {
      throw new BlobIntegrityError("Invalid OCI object key");
    }
    return { namespaceName: this.options.namespace, bucketName: this.options.bucket, objectName: key };
  }

  private async request<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation(await this.factory(AbortSignal.timeout(this.timeoutMs)));
      } catch (error) {
        if (error instanceof BlobIntegrityError) throw error;
        const status = statusOf(error);
        // Preserve not-found and conditional-create responses for the caller.
        if (status === 404 || status === 412) throw error;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt + 1 >= this.maxAttempts) throw new BlobStorageError(status, retryable);
        await new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
  }

  async put(key: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream"): Promise<string> {
    const ref = this.reference(key);
    const bytes = Buffer.from(data);
    const hash = sha256(bytes);
    try {
      await this.request(client => client.putObject({ ...ref, putObjectBody: bytes, contentLength: bytes.length,
        contentType, ifNoneMatch: "*", contentMD5: createHash("md5").update(bytes).digest("base64"),
        opcMeta: { sha256: hash } }));
    } catch (error) {
      if (statusOf(error) !== 412) throw error;
      const existing = await this.get(key);
      if (!existing || !existing.equals(bytes)) throw new BlobIntegrityError(`Immutable OCI object conflict: ${key}`);
    }
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const ref = this.reference(key);
    try {
      return await this.request(async client => {
        const response = await client.getObject(ref);
        if (response.contentLength > 100 * 1024 * 1024) {
          const stream = response.value as { destroy?: () => void; cancel?: () => Promise<void> };
          if (stream.destroy) stream.destroy(); else await stream.cancel?.();
          throw new BlobIntegrityError("OCI object exceeds the 100 MiB processing limit");
        }
        const chunks: Buffer[] = [];
        // OCI's Node SDK returns a readable stream; keep body consumption inside the timed/retried operation.
        for await (const chunk of response.value as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== response.contentLength) throw new BlobIntegrityError(`OCI size mismatch: ${key}`);
        if (response.opcMeta?.sha256 && sha256(bytes) !== response.opcMeta.sha256) {
          throw new BlobIntegrityError(`OCI checksum mismatch: ${key}`);
        }
        if (response.contentMd5 && createHash("md5").update(bytes).digest("base64") !== response.contentMd5) {
          throw new BlobIntegrityError(`OCI transport checksum mismatch: ${key}`);
        }
        return bytes;
      });
    } catch (error) { if (statusOf(error) === 404) return null; throw error; }
  }

  async exists(key: string): Promise<boolean> {
    const ref = this.reference(key);
    try { await this.request(client => client.headObject(ref)); return true; }
    catch (error) { if (statusOf(error) === 404) return false; throw error; }
  }

  async delete(key: string): Promise<void> {
    const ref = this.reference(key);
    try { await this.request(client => client.deleteObject(ref)); }
    catch (error) { if (statusOf(error) !== 404) throw error; }
  }

  async healthCheck() {
    const key = `_health/${randomUUID()}.json`;
    try {
      const bytes = Buffer.from(JSON.stringify({ probe: key }));
      await this.put(key, bytes, "application/json");
      if (!(await this.get(key))?.equals(bytes)) throw new BlobIntegrityError("OCI health readback mismatch");
      await this.delete(key);
      return { ok: true, backend: "oci_object_storage" };
    } catch (error) { return { ok: false, backend: "oci_object_storage", error: (error as Error).message }; }
  }
}
