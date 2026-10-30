-- Restore checks skipped by name-only probes when migrations ran in isolated schemas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'agents_lifecycle_check'
      AND t.relname = 'agents'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_lifecycle_check
      CHECK (lifecycle IN ('active', 'disabled', 'retired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'printers_lifecycle_check'
      AND t.relname = 'printers'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE printers
      ADD CONSTRAINT printers_lifecycle_check
      CHECK (lifecycle IN ('active', 'disabled', 'retired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'printers_device_class_check'
      AND t.relname = 'printers'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE printers
      ADD CONSTRAINT printers_device_class_check
      CHECK (device_class IN ('thermal', 'laser', 'inkjet', 'label', 'other', 'unknown'));
  END IF;
END $$;
