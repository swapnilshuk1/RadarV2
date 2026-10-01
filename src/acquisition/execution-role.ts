export function assertAcquisitionHost(env: NodeJS.ProcessEnv = process.env): void {
  if (env.RADAR_RUNTIME_ROLE === "processing") throw new Error("PORTAL_ACQUISITION_DISABLED_ON_PROCESSING_HOST");
  if (env.RADAR_DEPLOYMENT_MODE === "distributed" && env.RADAR_RUNTIME_ROLE !== "acquisition") {
    throw new Error("DISTRIBUTED_ACQUISITION_REQUIRES_DESIGNATED_ACQUISITION_HOST");
  }
}
