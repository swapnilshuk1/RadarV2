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

export class ExecutiveDashboardReadModel implements ReadModel {
  name = "ExecutiveDashboard";
  version = "1.0.0";

  rebuild(db: Database): void {
    db.exec(`DROP TABLE IF EXISTS rm_executive_dashboard`);
    db.exec(`
      CREATE TABLE rm_executive_dashboard (
        workspace_id TEXT PRIMARY KEY,
        
        -- aggregate metrics
        active_pursuits INTEGER NOT NULL,
        paused_pursuits INTEGER NOT NULL,
        capacity_percentage REAL NOT NULL,
        
        -- headspace limits
        max_monthly_pursuits INTEGER NOT NULL,
        
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
    db.exec(`DELETE FROM rm_executive_dashboard`);
  }

  apply(db: Database, event: TimelineEvent): void {
    const rebuiltAt = new Date().toISOString(); 
    const updatedAt = event.occurredAt;
    
    // 1. Initialize empty dashboard state on WorkspaceInitialized
    if ((event.eventCategory as string) === "Workspace" && event.eventType === "WorkspaceInitialized") {
      const checksum = this.calculateChecksum(this.version, event.eventVersion, "init");
      db.prepare(`
        INSERT OR IGNORE INTO rm_executive_dashboard 
        (workspace_id, active_pursuits, paused_pursuits, capacity_percentage, max_monthly_pursuits, read_model_version, rebuilt_at, updated_at, event_version, read_model_checksum)
        VALUES (?, 0, 0, 0.0, 5, ?, ?, ?, ?, ?)
      `).run(event.workspaceId, this.version, rebuiltAt, updatedAt, event.eventVersion, checksum);
    }
    
    // 2. Adjust limits based on CapacityAdjusted
    if ((event.eventCategory as string) === "Headspace" && event.eventType === "CapacityAdjusted") {
      const payload = JSON.parse(event.payloadJson);
      const maxMonthly = payload.limitValue || 5;
      
      const checksum = this.calculateChecksum(this.version, event.eventVersion, payload);
      
      db.prepare(`
        UPDATE rm_executive_dashboard
        SET 
          max_monthly_pursuits = ?,
          read_model_version = ?,
          rebuilt_at = ?,
          updated_at = ?,
          event_version = ?,
          read_model_checksum = ?
        WHERE workspace_id = ?
      `).run(maxMonthly, this.version, rebuiltAt, updatedAt, event.eventVersion, checksum, event.workspaceId);
    }
    
    // Note: In real life we'd also handle PursuitStarted / PursuitPaused to increment counters
  }

  checksum(db: Database): string {
    const rows = db.prepare("SELECT * FROM rm_executive_dashboard ORDER BY workspace_id").all();
    return sha256(JSON.stringify(rows));
  }

  private calculateChecksum(modelVersion: string, eventVersion: number, payload: any): string {
    return sha256(modelVersion + eventVersion.toString() + (typeof payload === 'string' ? payload : JSON.stringify(payload)));
  }
}
