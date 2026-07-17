import type { Database } from "better-sqlite3";
import type { TimelineEvent } from "../../../domain/entities";

export interface ReadModel {
  name: string;
  
  /** 
   * Deletes and rebuilds the schema for this read model 
   */
  rebuild(db: Database): void;
  
  /**
   * Clears all data from the read model without destroying the schema.
   * Useful for replay certification and targeted rebuilds.
   */
  clear(db: Database): void;
  
  /**
   * Applies a single event to the read model.
   * Business logic belongs upstream; this just maps Event -> Row.
   */
  apply(db: Database, event: TimelineEvent): void;
  
  /**
   * Calculates a deterministic checksum of the read model's current state.
   */
  checksum(db: Database): string;
}
