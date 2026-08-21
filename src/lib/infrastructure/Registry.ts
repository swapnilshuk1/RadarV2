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

export const globalPipelineRegistry = new PipelineRegistry();

