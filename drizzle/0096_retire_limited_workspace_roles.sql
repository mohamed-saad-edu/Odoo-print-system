-- Retire obsolete workspace roles while retaining the internal ownership
-- marker, which confers NO billing, team, or Platform Owner authority.
-- All live workspace families must reauthenticate after this cutover.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant_users WHERE role NOT IN
   ('owner','admin','operator','viewer','integration_admin','billing_admin')) THEN
    RAISE EXCEPTION 'Unexpected tenant membership role; investigate before migrating';
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_invitations WHERE role NOT IN
   ('admin','operator','viewer','integration_admin','billing_admin')) THEN
    RAISE EXCEPTION 'Unexpected tenant invitation role; investigate before migrating';
  END IF;
END $$;
--> statement-breakpoint
UPDATE refresh_tokens SET revoked_at=clock_timestamp(), revoked_reason='workspace_role_cutover'
WHERE kind IN ('customer','manager') AND revoked_at IS NULL;
--> statement-breakpoint
UPDATE manager_sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
--> statement-breakpoint
UPDATE tenant_users SET role='admin', updated_at=clock_timestamp()
WHERE role IN ('operator','viewer','integration_admin','billing_admin');
--> statement-breakpoint
UPDATE tenant_invitations SET role='admin'
WHERE role IN ('operator','viewer','integration_admin','billing_admin');
--> statement-breakpoint
UPDATE manager_sessions SET role='admin'
WHERE role IN ('operator','viewer','integration_admin','billing_admin');
--> statement-breakpoint
UPDATE refresh_tokens SET role='admin'
WHERE kind IN ('customer','manager') AND role IN ('operator','viewer','integration_admin','billing_admin');
--> statement-breakpoint
ALTER TABLE tenant_users ALTER COLUMN role SET DEFAULT 'admin';
--> statement-breakpoint
ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
--> statement-breakpoint
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check CHECK (role IN ('owner','admin'));
--> statement-breakpoint
ALTER TABLE tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_role_check;
--> statement-breakpoint
ALTER TABLE tenant_invitations ADD CONSTRAINT tenant_invitations_role_check CHECK (role='admin');
--> statement-breakpoint
ALTER TABLE manager_sessions DROP CONSTRAINT IF EXISTS manager_sessions_role_check;
--> statement-breakpoint
ALTER TABLE manager_sessions ADD CONSTRAINT manager_sessions_role_check CHECK (role IN ('owner','admin'));
