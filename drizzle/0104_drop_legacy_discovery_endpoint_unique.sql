-- Stable tenant/Agent identity replaces the endpoint-only discovery key from 0010.
DROP INDEX IF EXISTS "discovered_devices_agent_identity_unique";
