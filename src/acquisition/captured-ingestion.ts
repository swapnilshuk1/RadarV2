import { CanonicalIngestionService, type IngestOpportunityPayload, type IngestScope } from "./ingestion-service";
import { getBlobStore } from "../lib/storage/blob-store";
import { remoteAcquisitionOutbox } from "./outbox";
import { BlobStorageError } from "../lib/storage/oci-blob-store";

export async function ingestCapturedOpportunity(payload: IngestOpportunityPayload, scope: IngestScope,
  lease?: { owner: string; token: string; executionToken?: string }) {
  if (process.env.RADAR_ACQUISITION_INGRESS_URL) {
    if (scope.mode !== "SCOPED" || !lease) throw new Error("REMOTE_ACQUISITION_REQUIRES_SCOPED_WORKER_LEASE");
    try { return await remoteAcquisitionOutbox(getBlobStore({ enforceDistributed: true })).acquire(payload, scope, lease); }
    catch (error) {
      if (error instanceof BlobStorageError && error.retryable) {
        throw Object.assign(new Error(`ACQUISITION_UPLOAD_UNAVAILABLE: durable outbox retained; ${error.message}`), { code: "PERSISTENCE_UNAVAILABLE" });
      }
      throw error;
    }
  }
  return new CanonicalIngestionService().ingestOpportunity(payload, { scope, scrapeLease: lease });
}
