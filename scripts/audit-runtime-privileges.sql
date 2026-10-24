-- The dedicated role profile is identified by its exact per-database marker.
-- Audit correction/retention remains an explicit owner/administrator action.
-- Run after both profile application and owner migrations, because a fresh
-- install creates audit_events after default table privileges are configured.
DO $$
DECLARE runtime_role text;
DECLARE audit_column text;
BEGIN
  IF to_regclass('public.audit_events') IS NULL THEN RETURN; END IF;
  FOR runtime_role IN
    SELECT rolname FROM pg_roles
    WHERE shobj_description(oid, 'pg_authid') = 'Yaseir role profile v1 runtime ' || current_database()
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.audit_events FROM %I', runtime_role);
    -- A column grant survives a table-level REVOKE; close that drift path too.
    FOR audit_column IN
      SELECT attname FROM pg_attribute
      WHERE attrelid = 'public.audit_events'::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.audit_events FROM %I', audit_column, runtime_role);
    END LOOP;
  END LOOP;
END $$;
