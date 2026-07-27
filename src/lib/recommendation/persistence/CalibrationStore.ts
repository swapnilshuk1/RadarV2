import fs from "fs";
import path from "path";
import type { PolicyComparison } from "../RecommendationPolicy";

export interface CalibrationRunMetadata {
  id: string;
  timestamp: string;
  policyVersion: string;
  profileHash: string;
  corpusHash: string;
  volatility: number;
  excellentCount: number;
  goodCount: number;
  averageCount: number;
  weakCount: number;
  insufficientCount: number;
  avgScore: number;
  avgConfidence: number;
}

export class CalibrationStore {
  private db: any = null;

  constructor() {
    try {
      const dbPath = path.resolve(process.cwd(), "radar.sqlite");
      const DatabaseConstructor = typeof require !== "undefined" ? require("better-sqlite3") : null;
      if (DatabaseConstructor) {
        this.db = new DatabaseConstructor(dbPath);
        this.initializeTables();
      }
    } catch (err) {
      console.warn("[CalibrationStore] SQLite unavailable:", err);
    }
  }

  private initializeTables() {
    if (!this.db) return;
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS calibration_runs (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        policy_version TEXT,
        profile_hash TEXT,
        corpus_hash TEXT,
        volatility REAL,
        excellent_count INTEGER,
        good_count INTEGER,
        average_count INTEGER,
        weak_count INTEGER,
        insufficient_count INTEGER,
        avg_score REAL,
        avg_confidence REAL
      )
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS policy_comparisons (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        champion_policy_id TEXT,
        candidate_policy_id TEXT,
        corpus_hash TEXT,
        profile_hash TEXT,
        stability_index REAL,
        volatility REAL,
        excellent_delta INTEGER,
        good_delta INTEGER,
        average_delta INTEGER,
        weak_delta INTEGER,
        insufficient_delta INTEGER,
        winner TEXT
      )
    `).run();
  }

  public saveRun(run: CalibrationRunMetadata): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT OR REPLACE INTO calibration_runs (
        id, timestamp, policy_version, profile_hash, corpus_hash, volatility,
        excellent_count, good_count, average_count, weak_count, insufficient_count,
        avg_score, avg_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.timestamp,
      run.policyVersion,
      run.profileHash,
      run.corpusHash,
      run.volatility,
      run.excellentCount,
      run.goodCount,
      run.averageCount,
      run.weakCount,
      run.insufficientCount,
      run.avgScore,
      run.avgConfidence
    );
  }

  public saveComparison(comparison: PolicyComparison): void {
    if (!this.db) return;
    this.db.prepare(`
      INSERT OR REPLACE INTO policy_comparisons (
        id, timestamp, champion_policy_id, candidate_policy_id, corpus_hash, profile_hash,
        stability_index, volatility, excellent_delta, good_delta, average_delta, weak_delta,
        insufficient_delta, winner
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      comparison.id,
      comparison.timestamp,
      comparison.championPolicyId,
      comparison.candidatePolicyId,
      comparison.corpusHash,
      comparison.profileHash,
      comparison.stabilityIndex,
      comparison.volatility,
      comparison.excellentDelta,
      comparison.goodDelta,
      comparison.averageDelta,
      comparison.weakDelta,
      comparison.insufficientEvidenceDelta,
      comparison.winner
    );
  }

  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
