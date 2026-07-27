import type { Database } from "better-sqlite3";
import type { SqliteTimelineStore } from "../repositories/SqliteTimelineStore";
import type { ReadModel } from "./ReadModel";

export class ReadModelRebuilder {
  constructor(
    private db: Database,
    private timelineStore: SqliteTimelineStore,
    private readModels: ReadModel[]
  ) {}

  /**
   * Drops and recreates the read model tables, then replays the timeline.
   */
  public async rebuildAll(workspaceId: string) {
    for (const rm of this.readModels) {
      rm.rebuild(this.db);
    }
    
    await this.replay(workspaceId);
  }

  /**
   * Only clears and replays the timeline (useful for certification where we don't want to drop tables)
   */
  public async clearAndReplay(workspaceId: string) {
    for (const rm of this.readModels) {
      rm.clear(this.db);
    }

    await this.replay(workspaceId);
  }

  private async replay(workspaceId: string) {
    const events = await this.timelineStore.getEventStream(workspaceId);
    
    // Begin a transaction for the entire replay to ensure consistency and speed
    const applyTransaction = this.db.transaction(() => {
      for (const event of events) {
        for (const rm of this.readModels) {
          rm.apply(this.db, event);
        }
      }
    });

    applyTransaction();
  }
}
