import type { Database } from "better-sqlite3";
import type { TimelineEvent } from "../../../domain/entities";
import type { ReadModel } from "./ReadModel";
import crypto from "crypto";

export class OpportunityInboxReadModel implements ReadModel {
  name = "OpportunityInbox";
  version = "1.0.0";

  rebuild(db: Database): void {
    db.exec(`DROP TABLE IF EXISTS rm_opportunity_inbox`);
    db.exec(`
      CREATE TABLE rm_opportunity_inbox (
        opportunity_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        
        -- Core Fields
        title TEXT,
        company_name TEXT,
        status TEXT DEFAULT 'Active',
        
        -- Pre-calculated Rankings (Engine owns default ordering)
        priority_rank INTEGER DEFAULT 0,
        confidence_rank INTEGER DEFAULT 0,
        freshness_rank INTEGER DEFAULT 0,
        
        -- strict metadata
        read_model_version TEXT NOT NULL,
        rebuilt_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        event_version INTEGER NOT NULL,
        read_model_checksum TEXT NOT NULL
      )
    `);
  }

  clear(db: Database): void {
    db.exec(`DELETE FROM rm_opportunity_inbox`);
  }

  apply(db: Database, event: TimelineEvent): void {
    const rebuiltAt = new Date().toISOString(); // Mock for actual rebuild cycle time
    const updatedAt = event.occurredAt;
    
    if (event.eventCategory === "Acquisition" && event.eventType === "OpportunityDiscovered") {
      // Stub payload extraction
      const payload = {
         title: "New Opportunity",
         companyName: "Acme Corp",
         priorityRank: 0,
         confidenceRank: 0,
         freshnessRank: 100
      };

      const checksum = this.calculateChecksum(this.version, event.eventVersion, payload);

      db.prepare(`
        INSERT OR IGNORE INTO rm_opportunity_inbox 
        (opportunity_id, workspace_id, person_id, title, company_name, status, priority_rank, confidence_rank, freshness_rank, read_model_version, rebuilt_at, updated_at, event_version, read_model_checksum)
        VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.aggregateId, event.workspaceId, event.personId, 
        payload.title, payload.companyName, 
        payload.priorityRank, payload.confidenceRank, payload.freshnessRank,
        this.version, rebuiltAt, updatedAt, event.eventVersion, checksum
      );
    }
  }

  checksum(db: Database): string {
    const rows = db.prepare("SELECT * FROM rm_opportunity_inbox ORDER BY opportunity_id").all();
    return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }

  private calculateChecksum(modelVersion: string, eventVersion: number, payload: any): string {
    return crypto.createHash("sha256")
      .update(modelVersion)
      .update(eventVersion.toString())
      .update(JSON.stringify(payload))
      .digest("hex");
  }
}
