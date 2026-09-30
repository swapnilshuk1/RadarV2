import type { BlobStore } from "@/lib/storage/blob-store";

/** A missing durable source payload is an acquisition failure, never a sparse JD. */
export class SourcePayloadMissingError extends Error {
  constructor(readonly payloadKey: string) {
    super(`Source payload is unavailable in BlobStore: ${payloadKey}`);
    this.name = "SourcePayloadMissingError";
  }
}

/**
 * Reads the explicitly persisted payload reference for downstream extraction.
 * Callers must persist `source_payload_key`; this function deliberately does
 * not derive a path from an opportunity id or any other mutable state.
 */
export async function loadSourcePayload(blobStore: BlobStore, payloadKey: string | null | undefined): Promise<Buffer> {
  if (!payloadKey) {
    throw new SourcePayloadMissingError("<missing source_payload_key>");
  }
  const payload = await blobStore.get(payloadKey);
  if (!payload) throw new SourcePayloadMissingError(payloadKey);
  return payload;
}
