import type { Database } from "better-sqlite3";
import type { TimelineEvent } from "../../../domain/entities";
import type { ReadModel } from "./ReadModel";

function sha256(data: string): string {
  if (typeof window === "undefined") {
    try {
      const req = typeof require !== "undefined" ? require : null;
      if (req) {
        return req("crypto").createHash("sha256").update(data).digest("hex");
      }
    } catch {}
  }
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

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
        
        -- Normalized job info
        title TEXT NOT NULL,
        company_name TEXT NOT NULL,
        
        -- lifecycle states
        status TEXT NOT NULL, -- 'Active' | 'Dismissed' | 'Snoozed' | 'Engaged'
        
        -- computed priority rankings
        priority_rank INTEGER NOT NULL,
        confidence_rank INTEGER NOT NULL,
        freshness_rank INTEGER NOT NULL,
        
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
    const rebuiltAt = new Date().toISOString();
    const updatedAt = event.occurredAt;

    if ((event.eventCategory as string) === "Inbox" && event.eventType === "OpportunityInboxAdded") {
      const payload = JSON.parse(event.payloadJson);
      
      const checksum = this.calculateChecksum(this.version, event.eventVersion, payload);

      db.prepare(`
        INSERT INTO rm_opportunity_inbox 
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
    return sha256(JSON.stringify(rows));
  }

  private calculateChecksum(modelVersion: string, eventVersion: number, payload: any): string {
    return sha256(modelVersion + eventVersion.toString() + JSON.stringify(payload));
  }
}
