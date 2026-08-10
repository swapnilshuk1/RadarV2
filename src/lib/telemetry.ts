// src/lib/telemetry.ts
// Silent Behavioral Telemetry Logging Library
// Captures user interaction metrics (reading duration, instant passes, triage velocity)

export interface TelemetryLog {
  jobHash: string;
  action: "EXPAND" | "CLOSE" | "PURSUE" | "CONSIDER" | "PASS" | "UNDONE" | "NOT_EVALUABLE";
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

const KEY = "radar.telemetry.v1";

export function getTelemetryLogs(): TelemetryLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TelemetryLog[]) : [];
  } catch {
    return [];
  }
}

export function logTelemetry(
  jobHash: string,
  action: TelemetryLog["action"],
  durationMs: number,
  metadata?: Record<string, any>
) {
  if (typeof window === "undefined") return;
  try {
    const logs = getTelemetryLogs();
    const newLog: TelemetryLog = {
      jobHash,
      action,
      durationMs,
      timestamp: Date.now(),
      metadata,
    };
    logs.push(newLog);
    window.localStorage.setItem(KEY, JSON.stringify(logs));
    
    // Dispatch global custom event for any listening debug monitors or telemetry graphs
    window.dispatchEvent(new CustomEvent("radar:telemetry", { detail: newLog }));
  } catch (err) {
    console.error("[Telemetry] Failed to log telemetry item:", err);
  }
}

export function clearTelemetry() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {}
}
