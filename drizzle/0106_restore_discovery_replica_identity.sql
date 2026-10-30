-- Keep logical replication identity aligned with the agent-scoped discovery ID.
ALTER TABLE "discovered_devices" REPLICA IDENTITY USING INDEX "discovered_devices_tenant_agent_id_unique";
