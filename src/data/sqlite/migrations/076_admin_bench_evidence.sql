-- Completed publication evidence must not change after acceptance.
CREATE TRIGGER admin_bench_terminal_update BEFORE UPDATE ON admin_bench_runs
WHEN OLD.status IN ('passed','failed')
BEGIN SELECT RAISE(ABORT, 'BENCH_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER admin_bench_no_delete BEFORE DELETE ON admin_bench_runs
BEGIN SELECT RAISE(ABORT, 'BENCH_EVIDENCE_IMMUTABLE'); END;

CREATE TRIGGER admin_bench_transition BEFORE UPDATE OF status ON admin_bench_runs
WHEN NOT (
  (OLD.status='queued' AND NEW.status IN ('queued','running','failed')) OR
  (OLD.status='running' AND NEW.status IN ('running','passed','failed'))
)
BEGIN SELECT RAISE(ABORT, 'BENCH_STATE_TRANSITION_INVALID'); END;

CREATE TRIGGER admin_bench_identity BEFORE UPDATE ON admin_bench_runs
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR
  NEW.revision_id IS NOT OLD.revision_id OR NEW.active_revision_id IS NOT OLD.active_revision_id OR
  NEW.token_cap IS NOT OLD.token_cap OR NEW.created_at IS NOT OLD.created_at OR
  NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'BENCH_IDENTITY_IMMUTABLE'); END;
