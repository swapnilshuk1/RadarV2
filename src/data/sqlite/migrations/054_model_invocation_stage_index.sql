-- 054_model_invocation_stage_index.sql
-- Stage-level latency/token dashboards aggregate by pipeline + stage over time.
CREATE INDEX IF NOT EXISTS idx_model_invocations_pipeline_stage_time
  ON model_invocations(pipeline, stage, started_at);
