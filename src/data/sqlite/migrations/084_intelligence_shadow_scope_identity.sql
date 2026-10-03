CREATE TRIGGER intelligence_shadow_scope_identity BEFORE UPDATE ON intelligence_taxonomy_shadows
WHEN NEW.scope_kind IS NOT OLD.scope_kind
BEGIN SELECT RAISE(ABORT,'INTELLIGENCE_SHADOW_IDENTITY_IMMUTABLE'); END;
