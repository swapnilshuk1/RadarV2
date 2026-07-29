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

export class CareerMemoryReadModel implements ReadModel {
  name = "CareerMemory";
  version = "1.0.0";

  rebuild(db: Database): void {
    db.exec(`DROP TABLE IF EXISTS rm_career_memory`);
    db.exec(`
      CREATE TABLE rm_career_memory (
        person_id TEXT NOT NULL,
        attribute TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        
        -- Current Preference
        state TEXT NOT NULL,
        weight REAL NOT NULL,
        
        -- Explanation
        reason TEXT,
        evidence_count INTEGER NOT NULL,
        
        -- strict metadata
        read_model_version TEXT NOT NULL,
        rebuilt_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        event_version INTEGER NOT NULL,
        read_model_checksum TEXT NOT NULL,
        
        PRIMARY KEY (person_id, attribute)
      )
    `);
  }

  clear(db: Database): void {
    db.exec(`DELETE FROM rm_career_memory`);
  }

  apply(db: Database, event: TimelineEvent): void {
    const rebuiltAt = new Date().toISOString(); 
    const updatedAt = event.occurredAt;
    
    if (event.eventCategory === "Memory" && event.eventType === "PreferenceDerived") {
      const payload = JSON.parse(event.payloadJson);
      
      const checksum = this.calculateChecksum(this.version, event.eventVersion, payload);

      db.prepare(`
        INSERT INTO rm_career_memory 
        (person_id, attribute, workspace_id, state, weight, reason, evidence_count, read_model_version, rebuilt_at, updated_at, event_version, read_model_checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id, attribute) DO UPDATE SET
          state = excluded.state,
          weight = excluded.weight,
          reason = excluded.reason,
          evidence_count = excluded.evidence_count,
          read_model_version = excluded.read_model_version,
          rebuilt_at = excluded.rebuilt_at,
          updated_at = excluded.updated_at,
          event_version = excluded.event_version,
          read_model_checksum = excluded.read_model_checksum
      `).run(
        event.personId,
        payload.attribute,
        event.workspaceId,
        payload.state,
        payload.weight,
        payload.reason || "Derived from historical decisions",
        payload.evidenceCount,
        this.version,
        rebuiltAt,
        updatedAt,
        event.eventVersion,
        checksum
      );
    }
  }

  checksum(db: Database): string {
    const rows = db.prepare("SELECT * FROM rm_career_memory ORDER BY person_id, attribute").all();
    return sha256(JSON.stringify(rows));
  }

  private calculateChecksum(modelVersion: string, eventVersion: number, payload: any): string {
    return sha256(modelVersion + eventVersion.toString() + JSON.stringify(payload));
  }
}
