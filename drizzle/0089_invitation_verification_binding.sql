-- A pending invited user must join the invitation workspace, not create
-- a parallel owner workspace when verifying their email.
ALTER TABLE email_verification_tokens
  ADD COLUMN IF NOT EXISTS invitation_id text
  REFERENCES tenant_invitations(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_verification_tokens_invitation_id_idx
  ON email_verification_tokens (invitation_id)
  WHERE invitation_id IS NOT NULL;
