-- Local IDs belong to one Agent. Preserve every observation and external ID.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'discovered_devices'::regclass
      AND conname = 'discovered_devices_tenant_agent_id_unique'
  ) THEN
    ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_tenant_agent_id_unique"
      UNIQUE("tenant_id", "agent_id", "id");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "discovered_devices" DROP CONSTRAINT IF EXISTS "discovered_devices_tenant_id_unique";
