import { ReadModel } from "../../data/sqlite/read_models/ReadModel";
import { ExecutiveDashboardReadModel } from "../../data/sqlite/read_models/ExecutiveDashboardReadModel";
import { OpportunityInboxReadModel } from "../../data/sqlite/read_models/OpportunityInboxReadModel";
import { CareerMemoryReadModel } from "../../data/sqlite/read_models/CareerMemoryReadModel";

export class PipelineRegistry {
  private pipelines: Map<string, any> = new Map();
  private manifests: Map<string, any> = new Map();

  public register(manifest: any, pipelineInstance: any) {
    this.pipelines.set(manifest.name, pipelineInstance);
    this.manifests.set(manifest.name, manifest);
  }

  public getManifests() {
    return Array.from(this.manifests.values());
  }

  public getPipeline(name: string) {
    return this.pipelines.get(name);
  }
}

export class ReadModelRegistry {
  private readModels: Map<string, ReadModel> = new Map();

  public register(readModel: ReadModel) {
    this.readModels.set(readModel.name, readModel);
  }

  public getReadModels(): ReadModel[] {
    return Array.from(this.readModels.values());
  }

  public getReadModel(name: string): ReadModel | undefined {
    return this.readModels.get(name);
  }
}

export const globalPipelineRegistry = new PipelineRegistry();
export const globalReadModelRegistry = new ReadModelRegistry();

export function initializeReadModels() {
  globalReadModelRegistry.register(new OpportunityInboxReadModel());
  globalReadModelRegistry.register(new CareerMemoryReadModel());
  globalReadModelRegistry.register(new ExecutiveDashboardReadModel());
}
