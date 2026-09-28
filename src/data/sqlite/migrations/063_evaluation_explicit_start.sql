-- Evaluation is user-controlled: existing pre-production RUNNING scopes must
-- not resume model-backed work merely because the evaluator service starts.
UPDATE evaluation_runtime_control
SET desired_state = 'STOPPED',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
    updated_by = NULL
WHERE desired_state = 'RUNNING';
